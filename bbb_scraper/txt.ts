// index.ts
import { Stagehand, Page, BrowserContext } from "@browserbasehq/stagehand";
import StagehandConfig from "./stagehand.config.js";
import chalk from "chalk";
import boxen from "boxen";
import { z } from "zod";
import fs from "fs";
import path from "path";

// ——— SCHEMA DEFINITIONS ————————————————————————————————
// single‐item schema for a listing card
const BusinessCardSchema = z.object({
  name: z.string().describe("Company name"),
  phone: z.string().describe("Phone number"),
  url: z.string().describe("Detail page URL"),
  accreditation: z.string().describe("Accreditation status"),
});
type BusinessCard = z.infer<typeof BusinessCardSchema>;

// **WRAP** the array in an object so Stagehand.accepts it
const BusinessListSchema = z.object({
  businesses: z.array(BusinessCardSchema),
});
type BusinessList = z.infer<typeof BusinessListSchema>;

// schema for the detail‐page extract
const BusinessDetailSchema = z.object({
  principal_contact: z.string().describe("Principal contact person"),
  address: z.string().describe("Street address"),
  accreditation: z.string().describe("Detailed accreditation status"),
});
type BusinessDetail = z.infer<typeof BusinessDetailSchema>;

// final combined type
type CompleteBusiness = BusinessCard & BusinessDetail;

// ——— UTILITY FUNCTIONS ————————————————————————————————
function normalizePhone(raw: string): string {
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
    b.name,
    normalizePhone(b.phone),
    b.principal_contact,
    b.url,
    b.address,
    b.accreditation,
  ]);
  return [headers, ...rows]
    .map((row) =>
      row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")
    )
    .join("\n");
}

async function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ——— CORE SCRAPER LOGIC ————————————————————————————————
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
    stagehand.log({
      category: "bbb-scraper",
      message: `Scraping page ${pageNum}/${maxPages}`,
      auxiliary: { url: { value: pageUrl, type: "string" } },
    });

    // ─── NAVIGATE & WAIT ──────────────────────────────────
    await stagehand.page.goto(pageUrl);
    await delay(2000);

    // ─── COOKIE BANNER ───────────────────────────────────
    try {
      await stagehand.page.act(
        "Click on any 'Accept All Cookies' button if present"
      );
      await delay(1000);
    } catch {}

    // ─── EXTRACT THE LIST OF CARDS ────────────────────────
    let businessCards: BusinessCard[] = [];
    try {
      const listResult: BusinessList = await stagehand.page.extract({
        instruction: `
          Extract all business listings from this BBB search-results page.
          Each business will be on a separate card.
          Return an object { businesses: [ ... ] } where each entry has:
            - name
            - phone
            - url
            - accreditation
        `,
        schema: BusinessListSchema,
      });
      businessCards = listResult.businesses;

      stagehand.log({
        category: "bbb-scraper",
        message: `Found ${businessCards.length} businesses on page ${pageNum}`,
        auxiliary: {
          count: { value: businessCards.length.toString(), type: "string" },
        },
      });
    } catch (err) {
      stagehand.log({
        category: "bbb-scraper",
        message: `Error extracting businesses on page ${pageNum}: ${err}`,
      });
      continue;
    }

    // ─── FOR EACH CARD: SCRAPE DETAIL PAGE ─────────────────
    for (const card of businessCards) {
      const key = `${card.name}-${normalizePhone(card.phone)}`;
      if (seen.has(key)) continue;

      let detailUrl = card.url;
      if (detailUrl.startsWith("/")) {
        detailUrl = `https://www.bbb.org${detailUrl}`;
      }

      try {
        stagehand.log({
          category: "bbb-scraper",
          message: `Scraping details for ${card.name}`,
        });

        await stagehand.page.goto(detailUrl);
        await delay(2000);

        const detail: BusinessDetail = await stagehand.page.extract({
          instruction: `
            On the BBB business profile page, extract:
            - principal_contact (from "Principal Contacts")
            - address (full street address)
            - accreditation (detailed status or badge text)
          `,
          schema: BusinessDetailSchema,
        });

        const complete: CompleteBusiness = {
          name: card.name,
          phone: normalizePhone(card.phone),
          url: detailUrl,
          accreditation: detail.accreditation || card.accreditation,
          principal_contact: detail.principal_contact,
          address: detail.address,
        };

        allBusinesses.push(complete);
        seen.add(key);

        await delay(1500 + Math.random() * 1000);
      } catch (err) {
        stagehand.log({
          category: "bbb-scraper",
          message: `Error on detail for ${card.name}: ${err}`,
        });
      }
    }

    stagehand.log({
      category: "bbb-scraper",
      message: `Completed page ${pageNum}, total so far ${allBusinesses.length}`,
    });
    await delay(3000 + Math.random() * 2000);
  }

  // ─── WRITE OUT CSV ─────────────────────────────────———
  const csv = createCSV(allBusinesses);
  const outPath = path.join(process.cwd(), "sh_medical_billing_companies.csv");
  fs.writeFileSync(outPath, csv, "utf-8");

  stagehand.log({
    category: "bbb-scraper",
    message: `Done! ${allBusinesses.length} unique businesses.`,
    auxiliary: {
      total: { value: allBusinesses.length.toString(), type: "string" },
      file: { value: outPath, type: "string" },
    },
  });

  return { businesses: allBusinesses, csvContent: csv, totalCount: allBusinesses.length };
}

// ——— WRAPPER / CLI / PROGRAMMATIC ENTRYPOINTS —————————————————
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

  try {
    const res = await scrapeBBBMedicalBilling({ stagehand, baseUrl, maxPages });
    console.log(chalk.green(`✅ Scrape succeeded: ${res.totalCount} entries.`));
    console.log(chalk.blue(`💾 CSV written to sh_medical_billing_companies.csv`));
    return res;
  } catch (err) {
    console.error(chalk.red(`❌ Scrape failed: ${err}`));
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

run();
