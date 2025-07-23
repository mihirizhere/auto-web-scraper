// pages/api/companies.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { supabase } from '../../lib/supabase'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const page = parseInt((req.query.page as string) || '1', 10)
  const limit = parseInt((req.query.limit as string) || '50', 10)
  const search = (req.query.search as string) || ''
  const offset = (page - 1) * limit

  try {
    let qb = supabase
      .from('medical_billing_companies')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (search) {
      qb = qb.ilike('name', `%${search}%`)
    }

    const { data, count, error } = await qb
    if (error) throw error

    res.status(200).json({
      success: true,
      data: data ?? [],
      pagination: {
        page,
        limit,
        total: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / limit),
      },
    })
  } catch (err: any) {
    console.error('[/api/companies] error', err)
    res.status(500).json({ error: err.message ?? 'Internal error' })
  }
}
