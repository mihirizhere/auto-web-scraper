// pages/api/scrape.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { runBBBScraper } from '../../index'
import { supabaseAdmin } from '../../lib/supabase'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { url, maxPages } = req.body as { url?: string; maxPages?: number }
  if (!url) {
    return res.status(400).json({ error: 'Missing `url` in request body' })
  }

  try {
    // 1) run the Stagehand scraper
    const { businesses } = await runBBBScraper({
      targetUrl: url,
      maxPages: maxPages ?? 15,
    })

    // 2) insert into Supabase
    const rows = businesses.map(b => ({
      name: b.name,
      phone: b.phone,
      principal_contact: b.principal_contact,
      url: b.url,
      address: b.address,
      accreditation: b.accreditation,
      scraped_from_url: url,
    }))

    const { error: insertError } = await supabaseAdmin
      .from('medical_billing_companies')
      .insert(rows)

    if (insertError) throw insertError

    res.status(200).json({ success: true, count: businesses.length })
  } catch (error: any) {
    console.error('[/api/scrape] error', error)
    res.status(500).json({ error: error.message ?? 'Internal error' })
  }
}
