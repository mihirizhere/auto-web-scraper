import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "./stagehand.config.js";
import chalk from "chalk";
import { z } from "zod";
import fs from "fs";
import path from "path";

// ——— SCHEMAS
const BusinessCardSchema = z.object({
  name: z.string().describe("Company name"),
  phone: z.string().default("").describe("Phone number"),
  url: z.string().describe("Detail page URL or relative path"),
});

const BusinessListSchema = z.object({
  businesses: z.array(BusinessCardSchema),
});

const BusinessDetailSchema = z.object({
  principal_contact: z.string().default("").describe("Principal contact person"),
  address: z.string().default("").describe("Street address"),
  accreditation: z.string().default("Not Listed").describe("Accreditation status"),
});

type BusinessCard = z.infer<typeof BusinessCardSchema>;
type BusinessDetail = z.infer<typeof BusinessDetailSchema>;
type CompleteBusiness = BusinessCard & BusinessDetail;

// ——— UTILITIES 
function normalizePhone(raw: string): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  return digits.length === 10 ? `+1${digits}` : digits ? `+${digits}` : "";
}

function createCSV(businesses: CompleteBusiness[]): string {
  const headers = ["name", "phone", "principal_contact", "url", "address", "accreditation"];
  const rows = businesses.map(b => [
    b.name || "",
    normalizePhone(b.phone || ""),
    b.principal_contact || "",
    b.url || "",
    b.address || "",
    b.accreditation || "Not Listed",
  ]);
  
  return [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeUrl(url: string): string {
  if (!url) {
    throw new Error("Empty URL provided");
  }
  
  // Check if it's already a full URL
  if (url.startsWith("https://")) {
    return url;
  }
  
  // Check if it starts with /us/ (proper BBB profile path)
  if (url.startsWith("/us/")) {
    return `https://www.bbb.org${url}`;
  }
  
  if (url.startsWith("/")) {
    return `https://www.bbb.org${url}`;
  }
  
  if (!url.includes('/') && !url.includes('.')) {
    throw new Error(`Invalid URL - appears to be business name instead of URL: ${url}`);
  }
  
  return `https://www.bbb.org/${url}`;
}

// ——— MAIN SCRAPER ————————————————————————————————
async function scrapeBBBMedicalBilling({
  stagehand,
  baseUrl,
  maxPages = 15,
}: {
  stagehand: Stagehand;
  baseUrl: string;
  maxPages?: number;
}) {
  const allBusinesses: CompleteBusiness[] = [];
  const seen = new Set<string>();

  console.log(chalk.blue(`🚀 Starting scraper: ${maxPages} pages max`));

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const pageUrl = baseUrl.replace(/page=\d+/, `page=${pageNum}`);
    console.log(chalk.gray(`\n Page ${pageNum}/${maxPages}: ${pageUrl}`));

    try {
      // Navigate and handle popups
      await stagehand.page.goto(pageUrl, { waitUntil: 'networkidle' });
      await delay(2000);

      // Handle cookie banner
      try {
        await stagehand.page.act("Click any 'Accept All Cookies' or cookie consent button if present");
        await delay(1000);
      } catch {}

      // Handle accreditation filter popup
      try {
        await stagehand.page.act("If there's a popup asking about accreditation filter, select 'all businesses' and submit");
        await delay(1000);
      } catch {}

      // Extract business names and phones first (without URLs to avoid hallucination)
      console.log(chalk.gray("🔍 Extracting business info (without URLs)..."));
      const basicInfoSchema = z.object({
        businesses: z.array(z.object({
          name: z.string().describe("Company name"),
          phone: z.string().default("").describe("Phone number"),
        }))
      });
      
      const basicInfoResult = await stagehand.page.extract({
        instruction: `
          Extract basic information for all business listings on this BBB search results page:
          - name: The business/company name 
          - phone: Phone number if displayed
          
          Only extract from actual business listings in the search results, not from advertisements or sponsored content.
          Do NOT include URLs - just name and phone for each business.
        `,
        schema: basicInfoSchema,
      });

      const basicBusinesses = basicInfoResult.businesses || [];
      console.log(chalk.green(`Found ${basicBusinesses.length} businesses`));
      
      if (basicBusinesses.length === 0) {
        console.log(chalk.yellow(" No businesses found on this page"));
        continue;
      }

      // Now get actual URLs by clicking on each business name
      console.log(chalk.gray("🔗 Getting real URLs by clicking business links..."));
      const collectedBusinessCards: BusinessCard[] = [];
      
      for (let i = 0; i < Math.min(basicBusinesses.length, 20); i++) { // Limit per page to avoid timeouts
        const business = basicBusinesses[i];
        try {
          console.log(chalk.gray(`  Clicking: ${business.name}`));
          
          // Store current URL
          const currentUrl = stagehand.page.url();
          
          // Click on the business name link - be more specific to avoid ads
          await stagehand.page.act(`
            Click on the main business name link for "${business.name}" in the search results page.
            Only click on legitimate business profile links, NOT on advertisements or sponsored content.
            Look for links that go to BBB business profile pages (usually contain /profile/ in the URL).
          `);
          await delay(2000);
          
          // Get the new URL
          const newUrl = stagehand.page.url();
          
          // Verify we navigated to a profile page
          if (newUrl !== currentUrl && newUrl.includes('/profile/')) {
            console.log(chalk.green(`    Got URL: ${newUrl}`));
            
            collectedBusinessCards.push({
              name: business.name,
              phone: business.phone,
              url: newUrl,
            });
            
            // Go back to search results
            await stagehand.page.goBack();
            await delay(1500);
            
            // Verify we're back on search results
            const backUrl = stagehand.page.url();
            if (!backUrl.includes('search')) {
              console.log(chalk.yellow("Not on search page, re-navigating"));
              await stagehand.page.goto(pageUrl, { waitUntil: 'networkidle' });
              await delay(2000);
            }
            
          } else {
            console.log(chalk.yellow(`    No navigation for ${business.name} (${currentUrl} -> ${newUrl})`));
          }
          
        } catch (clickError) {
          console.log(chalk.red(`    Click failed for ${business.name}: ${clickError}`));
          
          // Try to get back to search page if we're lost
          if (!stagehand.page.url().includes('search')) {
            await stagehand.page.goto(pageUrl, { waitUntil: 'networkidle' });
            await delay(2000);
          }
        }
      }

      console.log(chalk.green(`Successfully collected ${collectedBusinessCards.length} businesses with real URLs`));
      
      // Debug: Show all URLs to verify they're correct
      if (collectedBusinessCards.length > 0) {
        console.log(chalk.blue("🔗 Real URLs collected:"));
        collectedBusinessCards.forEach((card: BusinessCard, i: number) => {
          console.log(chalk.gray(`  ${i + 1}. ${card.name}`));
          console.log(chalk.gray(`     ${card.url}`));
        });
      }

      if (collectedBusinessCards.length === 0) {
        console.log(chalk.yellow("No businesses found on this page"));
        continue;
      }

      // Process each business detail
      for (const card of collectedBusinessCards) {
        const key = `${card.name}-${normalizePhone(card.phone || "")}`;
        if (seen.has(key)) {
          console.log(chalk.gray(`Skipping duplicate: ${card.name}`));
          continue;
        }

        try {
          // The URL is already complete from the click-based extraction
          const detailUrl = card.url;
          console.log(chalk.gray(`Processing: ${card.name}`));
          console.log(chalk.gray(`URL: ${detailUrl}`));

          // We already navigated here during URL collection, so the page might already be loaded
          const currentUrl = stagehand.page.url();
          if (currentUrl !== detailUrl) {
            await stagehand.page.goto(detailUrl, { waitUntil: 'networkidle' });
            await delay(2000);
          }

          const detail = await stagehand.page.extract({
            instruction: `
              Extract contact details from this BBB business profile:
              - principal_contact: Name of main contact person or business owner
              - address: Full street address (street, city, state, zip)
              - accreditation: BBB accreditation status - should be "Accredited" or "Not Accredited"
            `,
            schema: BusinessDetailSchema,
          });

          const completeBusiness: CompleteBusiness = {
            name: card.name,
            phone: normalizePhone(card.phone || ""),
            url: card.url, // URL from clicking
            principal_contact: detail.principal_contact || "",
            address: detail.address || "",
            accreditation: detail.accreditation || "Not Listed",
          };

          allBusinesses.push(completeBusiness);
          seen.add(key);
          
          console.log(chalk.green(`Added: ${card.name} (Total: ${allBusinesses.length})`));
          await delay(1500 + Math.random() * 1000);

        } catch (error) {
          console.log(chalk.red(`Failed to process ${card.name}: ${error}`));
          
          // Add basic info even if detail scraping fails
          const basicBusiness: CompleteBusiness = {
            name: card.name,
            phone: normalizePhone(card.phone || ""),
            url: card.url,
            principal_contact: "",
            address: "",
            accreditation: "Not Listed",
          };
          allBusinesses.push(basicBusiness);
          seen.add(key);
        }
      }

      await delay(3000 + Math.random() * 2000);

    } catch (pageError) {
      console.log(chalk.red(`Error on page ${pageNum}: ${pageError}`));
      continue;
    }
  }

  // Save results
  if (allBusinesses.length > 0) {
    const csv = createCSV(allBusinesses);
    const outPath = path.join(process.cwd(), "medical_billing_companies.csv");
    fs.writeFileSync(outPath, csv, "utf-8");
    
    console.log(chalk.green(`\n SUCCESS! Extracted ${allBusinesses.length} businesses`));
    console.log(chalk.blue(` CSV saved to: ${outPath}`));
  } else {
    console.log(chalk.red("No businesses extracted"));
  }

  return { 
    businesses: allBusinesses, 
    csvContent: allBusinesses.length > 0 ? createCSV(allBusinesses) : "",
    totalCount: allBusinesses.length 
  };
}

// ——— MAIN FUNCTION 
async function main({
  stagehand,
  targetUrl,
  maxPages = 15,
}: {
  stagehand: Stagehand;
  targetUrl?: string;
  maxPages?: number;
}) {
  const defaultUrl = "https://www.bbb.org/search?filter_category=60548-100&filter_category=60142-000&filter_ratings=A&find_country=USA&find_text=Medical+Billing&page=1";
  const baseUrl = targetUrl || defaultUrl;

  try {
    return await scrapeBBBMedicalBilling({ stagehand, baseUrl, maxPages });
  } catch (error) {
    console.error(chalk.red(`Scraper failed: ${error}`));
    throw error;
  }
}

// ——— EXPORTS & CLI
export async function runBBBScraper(options: {
  targetUrl?: string;
  maxPages?: number;
  stagehandConfig?: any;
}) {
  const stagehand = new Stagehand({ ...StagehandConfig, ...options.stagehandConfig });
  await stagehand.init();
  
  try {
    return await main({ 
      stagehand, 
      targetUrl: options.targetUrl, 
      maxPages: options.maxPages 
    });
  } finally {
    await stagehand.close();
  }
}

async function run() {
  const stagehand = new Stagehand(StagehandConfig);
  await stagehand.init();
  
  try {
    const [urlArg, pagesArg] = process.argv.slice(2);
    await main({
      stagehand,
      targetUrl: urlArg,
      maxPages: pagesArg ? parseInt(pagesArg, 10) : 15,
    });
  } finally {
    await stagehand.close();
    console.log(chalk.blue("\n🤘 Thanks for using the BBB scraper!"));
  }
}

// Run
if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}