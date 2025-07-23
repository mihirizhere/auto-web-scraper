// pages/index.tsx
import { useState, useEffect } from 'react'
import Head from 'next/head'
import styles from '../../styles/Home.module.css'

type Company = {
  id: string
  name: string
  phone: string
  principal_contact: string
  url: string
  address: string
  accreditation: string
  scraped_from_url: string
  created_at: string
}

export default function Home() {
  const [url, setUrl] = useState('')
  const [maxPages, setMaxPages] = useState(5)
  const [msg, setMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])

  // fetch saved companies on load
  useEffect(() => {
    fetch('/api/companies')
      .then(r => r.json())
      .then(json => setCompanies(json.data ?? []))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)
    setLoading(true)
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, maxPages }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || 'Scrape failed')
      setMsg(`Scraped & saved ${payload.count} businesses.`)
      // reload table
      const list = await fetch('/api/companies').then(r => r.json())
      setCompanies(list.data)
    } catch (err: any) {
      setMsg(`${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.container}>
      <Head>
        <title>BBB Scraper</title>
      </Head>
      <main className={styles.main}>
        <h1 className={styles.title}>BBB Medical Billing Scraper</h1>

        <form onSubmit={handleSubmit} className={styles.form}>
          <input
            type="url"
            placeholder="BBB Search URL"
            value={url}
            onChange={e => setUrl(e.target.value)}
            required
          />
          <input
            type="number"
            min={1}
            max={20}
            value={maxPages}
            onChange={e => setMaxPages(parseInt(e.target.value, 10))}
          />
          <button type="submit" disabled={loading}>
            {loading ? 'Scraping…' : 'Start Scrape'}
          </button>
        </form>

        {msg && <p className={styles.message}>{msg}</p>}

        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Contact</th>
              <th>Accreditation</th>
              <th>Address</th>
              <th>Profile</th>
            </tr>
          </thead>
          <tbody>
            {companies.map(c => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.phone}</td>
                <td>{c.principal_contact}</td>
                <td>{c.accreditation}</td>
                <td>{c.address}</td>
                <td>
                  <a href={c.url} target="_blank" rel="noopener noreferrer">
                    View
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </div>
  )
}
