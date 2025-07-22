// index.ts - Debugged Version
import { Stagehand, Page, BrowserContext } from "@browserbasehq/stagehand";
import StagehandConfig from "./stagehand.config.js";
import chalk from "chalk";
import boxen from "boxen";
import { z } from "zod";
import fs from "fs";
import path from "path";

// ——— SCHEMA 
const BusinessCardSchema = z.object({
  name: z.string().describe("Company name"),
  phone: z.string().default("").describe("Phone number"),
  url: z.string().describe("Detail page URL or relative path"),
});
type BusinessCard = z.infer<typeof BusinessCardSchema>;

const BusinessListSchema = z.object({
  businesses: z.array(BusinessCardSchema),
});
type BusinessList = z.infer<typeof BusinessListSchema>;

const BusinessDetailSchema = z.object({
  principal_contact: z.string().default("").describe("Principal contact person"),
  address: z.string().default("").describe("Street address"),
  accreditation: z.string().optional().default("Not Accredited").describe("Accreditation status"),
});
type BusinessDetail = z.infer<typeof BusinessDetailSchema>;

type CompleteBusiness = BusinessCard & BusinessDetail;

function normalizePhone(raw: string): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  return digits ? `+${digits}` : "";
}

function createCSV(businesses: CompleteBusiness[]): string {
  const headers = [
    "name",
    "phone", 
    "principal_contact",
    "url",
    "address",
    "accreditation",
  ];
  const rows = businesses.map((b) => [
    b.name || "",
    normalizePhone(b.phone || ""),
    b.principal_contact || "",
    b.url || "",
    b.address || "",
    b.accreditation || "",
  ]);
  return [headers, ...rows]
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
    )
    .join("\n");
}

async function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Enhanced debugging function
async function debugPageContent(page: Page, stageName: string) {
  try {
    const title = await page.title();
    const url = page.url();
    console.log(chalk.yellow(`🔍 [${stageName}] Page title: "${title}"`));
    console.log(chalk.yellow(`🔍 [${stageName}] Current URL: ${url}`));
    
    // Check if page loaded properly
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 200) || "No body content");
    console.log(chalk.yellow(`🔍 [${stageName}] Body preview: ${bodyText.slice(0, 100)}...`));
    
    // Check for common BBB elements
    const bbbElements = await page.evaluate(() => {
      const elements = {
        searchResults: document.querySelectorAll('[data-testid*="search"]')?.length || 0,
        businessCards: document.querySelectorAll('[data-testid*="business"], div.card.result-card, .search-result')?.length || 0,
        listings: document.querySelectorAll('article, .listing, [role="article"]')?.length || 0,
      };
      return elements;
    });
    console.log(chalk.yellow(`[${stageName}] Found elements:`, bbbElements));
    
  } catch (error) {
    console.log(chalk.red(` Debug error for ${stageName}: ${error}`));
  }
}

// ——— CORE SCRAPER LOGIC ————————————————————————————————
async function scrapeBBBMedicalBilling({
  stagehand,
  baseUrl,
  maxPages = 15, // Reduced for debugging
}: {
  stagehand: Stagehand;
  baseUrl: string;
  maxPages?: number;
}) {
  const allBusinesses: CompleteBusiness[] = [];
  const seen = new Set<string>();

  stagehand.log({
    category: "bbb-scraper",
    message: "Starting BBB Medical Billing scraper",
    auxiliary: {
      baseUrl: { value: baseUrl, type: "string" },
      maxPages: { value: maxPages.toString(), type: "string" },
    },
  });

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const pageUrl = baseUrl.replace(/page=\d+/, `page=${pageNum}`);
    
    console.log(chalk.blue(`\nProcessing page ${pageNum}/${maxPages}`));
    console.log(chalk.gray(`URL: ${pageUrl}`));
    
    try {
      // ─── NAVIGATE
      console.log(chalk.gray(" Navigating to page..."));
      await stagehand.page.goto(pageUrl, { waitUntil: 'networkidle' });
      await delay(3000); // Increased wait time
      
      await debugPageContent(stagehand.page, `Page ${pageNum} Initial Load`);

      // ─── COOKIE
      console.log(chalk.gray(" Handling cookies..."));
      try {
        const cookieResult = await stagehand.page.act(
          "Look for and click any 'Accept All Cookies', 'Accept All', or similar cookie consent button if it exists"
        );
        console.log(chalk.green("✅ Cookie action completed"));
        await delay(2000);
      } catch (cookieError) {
        console.log(chalk.yellow("⚠️ No cookie banner found or couldn't click it"));
      }
      
      // ─── Accredited Filter
      console.log(chalk.gray("Looking for accredidation popup..."));
      try {
        const accreditationResult = await stagehand.page.act(
          `If there is a popup asking if we want to include only accredited or all business, select all business's radio button and click submit. 
            If there is no popup specifically asking for our 'accredidation' filter, do nothing.`
        );
        console.log(chalk.green("✅ accredidation action completed"));
        await delay(2000);
      } catch (noAccredidation) {
        console.log(chalk.yellow("⚠️ No accredidation baner or couldn't click it"));
      }

      await debugPageContent(stagehand.page, `Page ${pageNum} After Cookies`);

      let businessCards: BusinessCard[] = [];
      
      const extractionStrategies = [
        {
          name: "BBB Business Link Extraction",
          instruction: `
            Extract all business listings from this BBB search results page.
            For each business listing, find:
            - name: The business/company name (text content)
            - phone: The phone number if displayed
            - url: The HREF/link URL that the business name links to (not the business name text itself - get the actual link/href attribute). It wil be a 'bbb.org' link
            - accreditation: Either accredited or not accredited
            
            IMPORTANT: The 'url' field must be the actual href/link destination that you would click to go to the business detail page, NOT the business name text.
            
            Return format: { businesses: [{ name: "Company Name", phone: "(555) 123-4567", url: "/business/company-name-12345", accreditation: "A+" }] }
          `
        },
        {
          name: "Detailed BBB Search Results",
          instruction: `
            Look at this BBB search results page and extract each business listing.
            For each business card/result:
            - name: business name (the clickable text)  
            - phone: phone number if shown
            - url: the actual link/href that the business name clicks to (extract the href attribute, not the text)
            - accreditation: any BBB rating or accreditation badge
            
            Make sure 'url' is the clickable link destination, not the business name itself.
          `
        },
        {
          name: "Generic Link-Based Extraction", 
          instruction: `
            Find business listings on this page where each has:
            - name: the business name
            - phone: contact phone if available  
            - url: the clickable link (href attribute) that goes to the business detail page
            - accreditation: any rating or status
            
            Focus on getting the actual link URLs, not just text content.
          `
        }
      ];

      for (const strategy of extractionStrategies) {
        if (businessCards.length > 0) break;
        
        console.log(chalk.gray(`🔄 Trying extraction strategy: ${strategy.name}`));
        
        try {
          const listResult: BusinessList = await stagehand.page.extract({
            instruction: strategy.instruction,
            schema: BusinessListSchema,
          });
          
          businessCards = listResult.businesses || [];
          console.log(chalk.green(`✅ ${strategy.name} found ${businessCards.length} businesses`));
          
          if (businessCards.length > 0) {
            console.log(chalk.blue("📋 Sample extracted business:"));
            console.log(JSON.stringify(businessCards[0], null, 2));
            
            const validBusinesses = businessCards.filter(card => {
              const hasValidUrl = card.url && (card.url.includes('/') || card.url.includes('.'));
              if (!hasValidUrl) {
                console.log(chalk.yellow(`⚠️ Filtering out ${card.name} - invalid URL: "${card.url}"`));
                return false;
              }
              return true;
            });
            
            if (validBusinesses.length > 0) {
              businessCards = validBusinesses;
              console.log(chalk.green(`✅ ${validBusinesses.length} businesses have valid URLs`));
              break;
            } else {
              console.log(chalk.yellow(`⚠️ No valid URLs found, trying next strategy...`));
              businessCards = [];
            }
          }
          
        } catch (extractError) {
          console.log(chalk.red(`❌ ${strategy.name} failed: ${extractError}`));
        }
        
        await delay(1000);
      }

      // If normal extraction failed, try alternative approach with clicking
      if (businessCards.length === 0) {
        console.log(chalk.yellow(`🔄 Trying alternative approach: Click-based URL extraction`));
        
        try {
          const basicBusinessList = await stagehand.page.extract({
            instruction: `
              Extract basic business information from this BBB search page:
              - name: business name
              - phone: phone number if shown  
              - accreditation: BBB rating
            `,
            schema: z.object({
              businesses: z.array(z.object({
                name: z.string(),
                phone: z.string().optional().default(""),
                accreditation: z.string().optional().default(""),
              }))
            })
          });
          
          console.log(chalk.blue(`📋 Found ${basicBusinessList.businesses.length} businesses for URL extraction`));
          
          // Now try to get URLs by clicking on each business name
          const businessesWithUrls: BusinessCard[] = [];
          
          for (const basicBusiness of basicBusinessList.businesses.slice(0, 5)) { // Limit for debugging
            try {
              console.log(chalk.gray(`🔗 Getting URL for: ${basicBusiness.name}`));
              
              // Try to click on the business name and capture the URL
              const currentUrl = stagehand.page.url();
              
              await stagehand.page.act(`Click on the business name "${basicBusiness.name}" to go to its detail page`);
              await delay(2000);
              
              const newUrl = stagehand.page.url();
              
              if (newUrl !== currentUrl && newUrl.includes('bbb.org')) {
                console.log(chalk.green(`✅ Got URL for ${basicBusiness.name}: ${newUrl}`));
                
                businessesWithUrls.push({
                  name: basicBusiness.name,
                  phone: basicBusiness.phone || "",
                  url: newUrl,
                });
                
                // Go back to search results
                await stagehand.page.goBack();
                await delay(2000);
              } else {
                console.log(chalk.yellow(`⚠️ No URL change for ${basicBusiness.name}`));
              }
              
            } catch (clickError) {
              console.log(chalk.red(`❌ Click failed for ${basicBusiness.name}: ${clickError}`));
            }
          }
          
          if (businessesWithUrls.length > 0) {
            businessCards = businessesWithUrls;
            console.log(chalk.green(`✅ Click-based extraction got ${businessCards.length} businesses with URLs`));
          }
          
        } catch (alternativeError) {
          console.log(chalk.red(`❌ Alternative extraction failed: ${alternativeError}`));
        }
      }

      if (businessCards.length === 0) {
        console.log(chalk.red(`❌ No businesses found on page ${pageNum}`));
        
        // Additional debugging w screenshot
        try {
          const screenshotPath = `debug_page_${pageNum}.png`;
          await stagehand.page.screenshot({ path: screenshotPath });
          console.log(chalk.yellow(`📸 Screenshot saved: ${screenshotPath}`));
        } catch (screenshotError) {
          console.log(chalk.red(`❌ Could not take screenshot: ${screenshotError}`));
        }
        
        continue;
      }

      // ─── PROCESS DETAIL PAGES
      const maxDetailsPerPage = Math.min(30, businessCards.length); // Limit for debugging
      console.log(chalk.blue(`🔍 Processing first ${maxDetailsPerPage} business details...`));
      
      for (let i = 0; i < maxDetailsPerPage; i++) {
        const card = businessCards[i];
        const key = `${card.name}-${normalizePhone(card.phone || "")}`;
        
        if (seen.has(key)) {
          console.log(chalk.yellow(`⏭️ Skipping duplicate: ${card.name}`));
          continue;
        }

        // Validate that we have a proper URL
        let detailUrl = card.url;
        
        if (!detailUrl.includes('/') && !detailUrl.includes('.')) {
          console.log(chalk.red(`❌ Invalid URL for ${card.name}: "${detailUrl}" - this looks like a business name, not a URL`));
          continue;
        }
        
        if (detailUrl.startsWith("/")) {
          detailUrl = `https://www.bbb.org${detailUrl}`;
        } else if (!detailUrl.startsWith("http")) {
          // If it doesn't start with / or http, it might be a relative path without leading slash
          detailUrl = `https://www.bbb.org/${detailUrl}`;
        }
        
        try {
          new URL(detailUrl);
        } catch (urlError) {
          console.log(chalk.red(`❌ Invalid URL format for ${card.name}: "${detailUrl}"`));
          continue;
        }

        console.log(chalk.gray(`🔍 Scraping details for: ${card.name}`));
        console.log(chalk.gray(`📄 Detail URL: ${detailUrl}`));

        try {
          await stagehand.page.goto(detailUrl, { waitUntil: 'networkidle' });
          await delay(3000);

          await debugPageContent(stagehand.page, `Detail Page - ${card.name}`);

          const detailStrategies = [
            {
              instruction: `
                Extract business contact details from this BBB business profile:
                - principal_contact: Name of main contact person or owner
                - address: Full street address including city, state, zip
                - accreditation: BBB accreditation status. Either 'Accredited' or 'Not Accredited'
              `
            },
            {
              instruction: `
                Find contact information on this business page:
                - principal_contact: contact person name
                - address: business address 
                - accreditation: BBB accreditation status. Either 'Accredited' or 'Not Accredited'
              `
            }
          ];

          let detail: BusinessDetail = { principal_contact: "", address: "", accreditation: "" };
          
          for (const strategy of detailStrategies) {
            try {
              detail = await stagehand.page.extract({
                instruction: strategy.instruction,
                schema: BusinessDetailSchema,
              });
              console.log(chalk.green("✅ Detail extraction successful"));
              break;
            } catch (detailError) {
              console.log(chalk.yellow(`⚠️ Detail extraction attempt failed: ${detailError}`));
            }
          }

          const complete: CompleteBusiness = {
            name: card.name,
            phone: normalizePhone(card.phone || ""),
            url: detailUrl,
            accreditation: detail.accreditation || "",
            principal_contact: detail.principal_contact || "",
            address: detail.address || "",
          };

          allBusinesses.push(complete);
          seen.add(key);
          
          console.log(chalk.green(`✅ Added business: ${card.name}`));
          console.log(chalk.gray(`📊 Total businesses so far: ${allBusinesses.length}`));

          await delay(2000 + Math.random() * 2000);
          
        } catch (detailError) {
          console.log(chalk.red(`❌ Detail scraping failed for ${card.name}: ${detailError}`));
          
          // Still add the basic card info if detail scraping fails
          const basicBusiness: CompleteBusiness = {
            name: card.name,
            phone: normalizePhone(card.phone || ""),
            url: detailUrl,
            accreditation: "",
            principal_contact: "",
            address: "",
          };
          
          allBusinesses.push(basicBusiness);
          seen.add(key);
          console.log(chalk.yellow(`⚠️ Added basic info for: ${card.name}`));
        }
      }

      console.log(chalk.blue(`✅ Completed page ${pageNum}: ${allBusinesses.length} total businesses`));
      await delay(3000 + Math.random() * 2000);
      
    } catch (pageError) {
      console.log(chalk.red(`❌ Error processing page ${pageNum}: ${pageError}`));
      continue;
    }
  }

  // ─── WRITE OUT CSV
  if (allBusinesses.length > 0) {
    const csv = createCSV(allBusinesses);
    const outPath = path.join(process.cwd(), "sh_medical_billing_companies.csv");
    fs.writeFileSync(outPath, csv, "utf-8");
    
    console.log(chalk.green(`\n🎉 SUCCESS! Extracted ${allBusinesses.length} businesses`));
    console.log(chalk.blue(`💾 CSV saved to: ${outPath}`));
    
    stagehand.log({
      category: "bbb-scraper",
      message: `Scraping completed successfully`,
      auxiliary: {
        total: { value: allBusinesses.length.toString(), type: "string" },
        file: { value: outPath, type: "string" },
      },
    });
  } else {
    console.log(chalk.red(`No businesses were extracted. Check the logs above for debugging info.`));
  }

  return { businesses: allBusinesses, csvContent: allBusinesses.length > 0 ? createCSV(allBusinesses) : "", totalCount: allBusinesses.length };
}

async function main({
  stagehand,
  targetUrl,
  maxPages = 15,
}: {
  stagehand: Stagehand;
  targetUrl?: string;
  maxPages?: number;
}) {
  const defaultUrl =
    "https://www.bbb.org/search?filter_category=60548-100&filter_category=60142-000&filter_ratings=A&find_country=USA&find_text=Medical+Billing&page=1";
  const baseUrl = targetUrl || defaultUrl;
  
  console.log(chalk.blue(`\n🚀 Starting BBB Medical Billing Scraper`));
  console.log(chalk.gray(`🌐 Target URL: ${baseUrl}`));
  console.log(chalk.gray(`📄 Max pages: ${maxPages}`));

  try {
    const res = await scrapeBBBMedicalBilling({ stagehand, baseUrl, maxPages });
    
    if (res.totalCount > 0) {
      console.log(chalk.green(`\n✅ Scraper completed successfully!`));
      console.log(chalk.blue(`📊 Total entries: ${res.totalCount}`));
      console.log(chalk.blue(`💾 CSV file: sh_medical_billing_companies.csv`));
    } else {
      console.log(chalk.red(`\n❌ No data extracted. Please check the debugging output above.`));
    }
    
    return res;
  } catch (err) {
    console.error(chalk.red(`❌ Scraper failed: ${err}`));
    throw err;
  }
}

export async function runBBBScraper(options: {
  targetUrl?: string;
  maxPages?: number;
  stagehandConfig?: any;
}) {
  const stagehand = new Stagehand({ ...StagehandConfig, ...options.stagehandConfig });
  await stagehand.init();
  try {
    return await main({ stagehand, targetUrl: options.targetUrl, maxPages: options.maxPages });
  } finally {
    await stagehand.close();
  }
}

async function run() {
  const stagehand = new Stagehand(StagehandConfig);
  await stagehand.init();
  
  if (StagehandConfig.env === "BROWSERBASE" && stagehand.browserbaseSessionID) {
    console.log(
      boxen(
        `Watch live: ${chalk.blue(
          `https://browserbase.com/sessions/${stagehand.browserbaseSessionID}`
        )}`,
        { title: "Browserbase", padding: 1, margin: 2 }
      )
    );
  }
  
  try {
    const [urlArg, pagesArg] = process.argv.slice(2);
    await main({
      stagehand,
      targetUrl: urlArg,
      maxPages: pagesArg ? parseInt(pagesArg, 10) : 15,
    });
  } finally {
    await stagehand.close();
    console.log(
      `\n🤘 Thanks for using the BBB scraper! Feedback? https://stagehand.dev/slack\n`
    );
  }
}

// Only run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}