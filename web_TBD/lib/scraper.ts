// web/lib/scraper.ts
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";

// Our company‐record shape
export type Entry = {
  name: string;
  phone: string;
  principal_contact?: string;
  url: string;
  address: string;
  accreditation: string;
};

/**
 * scrapeBBB:
 *   - spins up Stagehand (LLM+browser)
 *   - navigates to your BBB search URL
 *   - uses a single `page.extract` with a Zod schema
 *   - closes the browser and returns the JSON
 */
export async function scrapeBBB(searchUrl: string): Promise<Entry[]> {
  // 1) configure Stagehand with your OpenAI key from .env.local
  const sh = new Stagehand({
    env: "LOCAL",
    modelName: "openai/gpt-4.1-mini",
    modelClientOptions: {
      apiKey: process.env.OPENAI_API_KEY!,
    },
  });
  await sh.init();

  const page = sh.page;


  await page.goto(searchUrl);

  const { entries } = await page.extract({
    instruction: `
      On this BBB search-results page list every A‑rated "Medical Billing" business.
      For each, return a JSON array item with these keys:
       - name: the business name
       - phone: the phone number
       - principal_contact: the principal contact (if on detail page)
       - url: the detail‑page URL
       - address: the street address
       - accreditation: "Accredited" or "Not Accredited"
    `,
    schema: z.object({
      entries: z.array(
        z.object({
          name: z.string(),
          phone: z.string(),
          principal_contact: z.string().optional(),
          url: z.string().url(),
          address: z.string(),
          accreditation: z.string(),
        })
      ),
    }),
  });

  // 4) tear everything down and return
  await sh.close();
  return entries;
}
