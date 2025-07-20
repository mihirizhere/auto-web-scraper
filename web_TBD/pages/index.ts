import { useState } from "react";

type Entry = {
  name: string;
  phone: string;
  principal_contact: string;
  url: string;
  address: string;
  accreditation: string;
};

export default function Home() {
  const [url, setUrl] = useState("");
  const [results, setResults] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResults([]);
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = await res.json();
      if (res.ok && json.data) setResults(json.data);
      else alert(json.error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ maxWidth: 800, margin: "auto", padding: 16 }}>
      <h1>BBB Medical Billing Scraper</h1>

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, margin: "16px 0" }}>
        <input
          type="text"
          placeholder="Enter BBB search URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={{ flex: 1, padding: 8 }}
        />
        <button type="submit" disabled={loading} style={{ padding: "8px 16px" }}>
          {loading ? "Scraping..." : "Run Scraper"}
        </button>
      </form>

      {results.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Name", "Phone", "Contact", "Address", "Accreditation"].map((h) => (
                <th
                  key={h}
                  style={{ border: "1px solid #ddd", padding: 8, background: "#f0f0f0", textAlign: "left" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} style={{ background: i % 2 ? "#fafafa" : "white" }}>
                <td style={{ border: "1px solid #ddd", padding: 8 }}>{r.name}</td>
                <td style={{ border: "1px solid #ddd", padding: 8 }}>{r.phone}</td>
                <td style={{ border: "1px solid #ddd", padding: 8 }}>{r.principal_contact}</td>
                <td style={{ border: "1px solid #ddd", padding: 8 }}>{r.address}</td>
                <td style={{ border: "1px solid #ddd", padding: 8 }}>{r.accreditation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
