# scraper/stagehand.py
import asyncio
import json
import re
from urllib.parse import urljoin

from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
from crawl4ai.extraction_strategy import JsonCssExtractionStrategy

def run(input: dict):
    base = input.get("url")
    if not base:
        raise ValueError("Missing input.url")
    return asyncio.run(_scrape(base))

async def _scrape(base_url: str):
    # —– Define the same schemas you tested in bbb_scraper_crawl4ai.py —–
    list_schema = {
        "name": "bbb_listings",
        "baseSelector":"div.card.result-card",
        "fields":[
            {"name":"name",    "selector":"h3.result-business-name","type":"text"},
            {"name":"phone",   "selector":"a[href^='tel']","type":"text"},
            {"name":"profile", "selector":"h3.result-business-name a","type":"attribute","attribute":"href"},
        ]
    }
    detail_schema = {
        "name":"bbb_details",
        "baseSelector":"main",
        "fields":[
            {"name":"principal_contact","selector":"div.bpr-details-dl-data dt:text('Principal Contacts') + dd","type":"text"},
            {"name":"accredited",       "selector":"div#accreditation img[alt*='accredited']","type":"boolean"},
            {"name":"address",          "selector":"div.bpr-overview-address p","type":"text"},
        ]
    }

    # —– Build crawler configs —–
    browser_cfg     = BrowserConfig(headless=True)
    list_cfg        = CrawlerRunConfig(extraction_strategy=JsonCssExtractionStrategy(list_schema),   cache_mode=CacheMode.BYPASS)
    detail_cfg      = CrawlerRunConfig(extraction_strategy=JsonCssExtractionStrategy(detail_schema), cache_mode=CacheMode.BYPASS)

    seen = set()
    entries = []

    async with AsyncWebCrawler(config=browser_cfg) as crawler:
        # 1) Gather raw listings from pages 1–15
        all_listings = []
        for p in range(1, 16):
            url = re.sub(r"page=\d+", f"page={p}", base_url)
            res = await crawler.arun(url=url, config=list_cfg)
            all_listings.extend(json.loads(res.extracted_content or "[]"))

        # 2) Dedupe & normalize
        unique = {}
        for itm in all_listings:
            raw = itm.get("name","")
            name = re.sub(r"(?<=[a-z])(?=[A-Z])"," ", raw).strip()
            ph = re.sub(r"\D","", itm.get("phone",""))
            if len(ph)==10: ph = f"+1{ph}"
            key = (name, ph)
            if key not in unique:
                unique[key] = {"name":name,"phone":ph,"profile":itm.get("profile","")}

        # 3) Visit each profile for details
        for u in unique.values():
            prof = urljoin("https://www.bbb.org", u["profile"])
            det = await crawler.arun(url=prof, config=detail_cfg)
            d = json.loads(det.extracted_content or "[{}]")[0]

            entries.append({
                "name":              u["name"],
                "phone":             u["phone"],
                "principal_contact": d.get("principal_contact",""),
                "url":               prof,
                "address":           " ".join(d.get("address",[])) if isinstance(d.get("address",[]),list) else d.get("address",""),
                "accreditation":     "Accredited" if d.get("accredited",False) else "Not Accredited"
            })

    return {"entries": entries}
