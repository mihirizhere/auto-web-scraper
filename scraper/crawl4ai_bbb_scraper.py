# scraper/bbb_scraper_crawl4ai.py

import asyncio
import json
import csv
import re
from urllib.parse import urljoin

from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
from crawl4ai.extraction_strategy import JsonCssExtractionStrategy


def normalize_phone(raw: str) -> str:
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 10:
        return f"+1{digits}"
    return f"+{digits}" if digits else ""


async def main():
    url_template = (
        "https://www.bbb.org/search?"
        "filter_category=60548-100&filter_category=60142-000"
        "&filter_ratings=A&find_country=USA"
        "&find_text=Medical+Billing&page={page}"
    )

    # ───── Phase 1: LISTINGS EXTRACTION ─────
    list_schema = {
        "name": "bbb_listings",
        "baseSelector": "div.card.result-card",
        "fields": [
            {"name": "name",    "selector": "h3.result-business-name",      "type": "text"},
            {"name": "phone",   "selector": "a[href^='tel']",               "type": "text"},
            {"name": "profile", "selector": "h3.result-business-name a",    "type": "attribute", "attribute": "href"},
        ],
    }
    list_strategy = JsonCssExtractionStrategy(list_schema)
    list_run_config = CrawlerRunConfig(
        extraction_strategy=list_strategy,
        cache_mode=CacheMode.BYPASS
    )

    # ───── Phase 2: DETAIL EXTRACTION ─────
    detail_schema = {
        "name": "bbb_detail",
        "baseSelector": "main",
        "fields": [
            {
              "name": "principal_contact",
              "selector": "div.bpr-details-dl-data dt:text('Principal Contacts') + dd",
              "type": "text"
            },
            {
              "name": "accredited",
              "selector": "div#accreditation img[alt*='accredited']",
              "type": "boolean"
            },
            {
              "name": "address",
              "selector": "div.bpr-overview-address p",
              "type": "text"
            },
        ],
    }
    detail_strategy = JsonCssExtractionStrategy(detail_schema)
    detail_run_config = CrawlerRunConfig(
        extraction_strategy=detail_strategy,
        cache_mode=CacheMode.BYPASS
    )

    # ───── Browser Setup ─────
    browser_cfg = BrowserConfig(headless=True, verbose=False)
    async with AsyncWebCrawler(config=browser_cfg) as crawler:
        # 1) Collect all listings
        listings = []
        for page_num in range(1, 16):
            url = url_template.format(page=page_num)
            print(f"-> Crawling list page {page_num}: {url}")
            result = await crawler.arun(url=url, config=list_run_config)
            items = json.loads(result.extracted_content)
            listings.extend(items)

        # 2) Deduplicate by (name, phone)
        unique = {}
        for itm in listings:
            raw_name = itm.get("name", "")
            name = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", raw_name).strip()
            
            phone = normalize_phone(itm.get("phone", ""))
            key = (name, phone)
            if key not in unique:
                unique[key] = {"name": name, "phone": phone, "profile": itm.get("profile", "ß")}

        # 3) Visit each profile for details
        final = []
        for entry in unique.values():
            profile_url = urljoin("https://www.bbb.org", entry["profile"])
            print(f"  Detail: {profile_url}")
            det = await crawler.arun(url=profile_url, config=detail_run_config)
            detail_items = json.loads(det.extracted_content) or [{}]
            d0 = detail_items[0]

            # Cleanup & merge
            principal = d0.get("principal_contact", "")
            acc = "Accredited" if d0.get("accredited", False) else "Not Accredited"
            addr = d0.get("address", [])
            address = " ".join(addr) if isinstance(addr, list) else addr

            final.append({
                "name":             entry["name"],
                "phone":            entry["phone"],
                "principal_contact": principal,
                "url":               profile_url,
                "address":           address,
                "accreditation":     acc
            })

        # 4) Write CSV
        with open("medical_billing_companies_2.csv", "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(
                f,
                fieldnames=["name","phone","principal_contact","url","address","accreditation"]
            )
            writer.writeheader()
            writer.writerows(final)

    print(" Done — output written to medical_billing_companies_2.csv")


if __name__ == "__main__":
    asyncio.run(main())
