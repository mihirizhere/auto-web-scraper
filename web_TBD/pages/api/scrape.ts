import type { NextApiRequest, NextApiResponse } from "next";
import { scrapeBBB, Entry } from "../../lib/scraper";
import { supabase } from "../../lib/supabase";

type Data = { data?: Entry[]; error?: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: "Missing url in request body" });
  }
  try {
    const entries = await scrapeBBB(url);

    // persist to Supabase
    const { data, error } = await supabase.from("businesses").insert(entries);
    if (error) throw error;

    return res.status(200).json({ data });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || "Unknown error" });
  }
}
