# scraper/bbb_scraper.py
from playwright.sync_api import sync_playwright
import csv
import re
import time
from urllib.parse import urljoin


def normalize_phone(raw: str) -> str:
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 10:
        return f"+1{digits}"
    return f"+{digits}" if digits else ""


from urllib.parse import urljoin

def extract_business_cards(page):
    cards = page.query_selector_all("div.card.result-card")
    data = []

    for card in cards:
        # — Name
        name_el = card.query_selector("h3.result-business-name")
        name = name_el.inner_text().strip() if name_el else ""

        # — Phone
        phone_el = card.query_selector("a[href^='tel']")
        phone_raw = phone_el.inner_text().strip() if phone_el else ""
        phone = normalize_phone(phone_raw)

        # — Detail URL
        link_el = card.query_selector("h3.result-business-name a")
        rel = link_el.get_attribute("href") if link_el else ""
        url = urljoin("https://www.bbb.org", rel)

        # — Accreditation badge
        accredited_img = card.query_selector("img[alt='Accredited Business']")
        accreditation = "Accredited" if accredited_img else "Not Accredited"

        data.append({
            "name": name,
            "phone": phone,
            "url": url,
            "accreditation": accreditation,
        })

    return data



def get_principal_contact(page) -> str:
    for div in page.query_selector_all("div.bpr-details-dl-data"):
        dt = div.query_selector("dt")
        if dt and dt.inner_text().strip() == "Principal Contacts":
            dd = div.query_selector("dd")
            return dd.inner_text().strip() if dd else ""
    return ""


def scrape_bbb():
    """
    Scrapes A‑rated Medical Billing listings from BBB.org (pages 1–15),
    visits each profile to pull principal contact, accreditation, and address,
    deduplicates on (name, phone), and writes results to medical_billing_companies.csv.
    """
    url_template = (
        "https://www.bbb.org/search?"
        "filter_category=60548-100&filter_category=60142-000"
        "&filter_ratings=A&find_country=USA"
        "&find_text=Medical+Billing&page={page}"
    )
    results = []
    seen = set()

    with sync_playwright() as p:
        # Launch headed browser with real UA to bypass Cloudflare interstitial
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/116.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 800},
        )
        page = context.new_page()

        for page_num in range(1, 16):
            src = url_template.format(page=page_num)
            print(f"Scraping list page: {src}")

            # 1) Navigate & wait for network idle
            page.goto(src, wait_until="networkidle")

            # 1.a) DEBUG: print a snippet of the loaded HTML
            html_snip = page.content()[:2000]
            print("⏩ HTML snippet:", html_snip)

            # 2) Dismiss cookie banner if it appears
            if page.is_visible("button:has-text('Accept All Cookies')"):
                page.click("button:has-text('Accept All Cookies')")
                page.wait_for_load_state("networkidle")

            # 3) Wait for listings to attach, fallback to inner header
            try:
                page.wait_for_selector("div.card.result-card", state="attached", timeout=20_000)
            except:
                print("⚠️  div.card.result-card not found, falling back to h3 selector")
                page.wait_for_selector("h3.result-business-name", timeout=20_000)

            # 4) Extract cards from the list page
            for entry in extract_business_cards(page):
                key = (entry["name"], entry["phone"])
                if key in seen:
                    continue

                # —————— DETAIL PAGE SCRAPE ——————
                detail = browser.new_page()
                detail.goto(entry["url"], wait_until="networkidle", timeout=20_000)
                try:
                    detail.wait_for_selector("main", timeout=10_000)

                    # 1) principal contact
                    entry["principal_contact"] = get_principal_contact(detail)

                    # 2) accreditation
                    badge = detail.query_selector("div#accreditation img[alt*='accredited' i]")
                    entry["accreditation"] = "Accredited" if badge else "Not Accredited"

                    # 3) address
                    addr_div = detail.query_selector("div.bpr-overview-address")
                    if addr_div:
                        ps = addr_div.query_selector_all("p")
                        lines = [p.inner_text().strip() for p in ps if p.inner_text().strip()]
                        entry["address"] = " ".join(lines)
                    else:
                        entry["address"] = ""

                except Exception as e:
                    print("Detail page error:", e)
                    entry["principal_contact"] = ""
                    entry["accreditation"] = "Unknown"
                    entry["address"] = ""
                finally:
                    detail.close()

                seen.add(key)
                results.append(entry)
                time.sleep(1)  # polite delay

        browser.close()

    # —————— WRITE CSV ——————
    with open("medical_billing_companies.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "name",
                "phone",
                "principal_contact",
                "url",
                "address",
                "accreditation",
            ],
        )
        writer.writeheader()
        for row in results:
            writer.writerow(row)

    url_template = (
        "https://www.bbb.org/search?"
        "filter_category=60548-100&filter_category=60142-000"
        "&filter_ratings=A&find_country=USA"
        "&find_text=Medical+Billing&page={page}"
    )
    results = []
    seen = set()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/116.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 800},
        )
        page = context.new_page()

        for page_num in range(1, 16):
            src = url_template.format(page=page_num)
            print(f"Scraping list page: {src}")

            # Navigate & wait until network is idle
            page.goto(src, wait_until="networkidle")

            # DEBUG: dump a bit of the loaded HTML
            html_snip = page.content()[:2000]
            print("⏩ HTML snippet:", html_snip)

            # Dismiss cookie banner if it appears
            if page.is_visible("button:has-text('Accept All Cookies')"):
                page.click("button:has-text('Accept All Cookies')")
                page.wait_for_load_state("networkidle")

            # Wait for your result cards, fallback to h3 if needed
            try:
                page.wait_for_selector("div.card.result-card", state="attached", timeout=20000)
            except:
                print("⚠️  div.card.result-card not found, falling back to h3 selector")
                page.wait_for_selector("h3.result-business-name", timeout=20000)


            for entry in extract_business_cards(page):
                key = (entry["name"], entry["phone"])
                if key in seen:
                    continue

                # —————— DETAIL PAGE SCRAPE ——————
                detail = browser.new_page()
                detail.goto(entry["url"], timeout=20_000)
                try:
                    detail.wait_for_selector("main", timeout=10_000)

                    # 1) principal contact
                    entry["principal_contact"] = get_principal_contact(detail)

                    # 2) accreditation
                    badge = detail.query_selector("div#accreditation img[alt*='accredited' i]")
                    entry["accreditation"] = "Accredited" if badge else "Not Accredited"

                    # 3) address
                    addr_div = detail.query_selector("div.bpr-overview-address")
                    if addr_div:
                        ps = addr_div.query_selector_all("p")
                        lines = [p.inner_text().strip() for p in ps if p.inner_text().strip()]
                        entry["address"] = " ".join(lines)
                    else:
                        entry["address"] = ""

                except Exception as e:
                    print("Detail page error:", e)
                    entry["principal_contact"] = ""
                    entry["accreditation"] = "Unknown"
                    entry["address"] = ""
                finally:
                    detail.close()

                seen.add(key)
                results.append(entry)
                time.sleep(1)  # polite delay

        browser.close()

    # —————— WRITE CSV ——————
    with open("medical_billing_companies.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "name",
                "phone",
                "principal_contact",
                "url",
                "address",
                "accreditation",
            ],
        )
        writer.writeheader()
        for row in results:
            writer.writerow(row)


if __name__ == "__main__":
    scrape_bbb()
