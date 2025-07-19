# scraper/bbb_scraper.py
from playwright.sync_api import sync_playwright
import csv
import re
import time
import random
from urllib.parse import urljoin


def normalize_phone(raw: str) -> str:
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 10:
        return f"+1{digits}"
    return f"+{digits}" if digits else ""


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


def random_delay():
    """Random delay between 2-5 seconds"""
    time.sleep(random.uniform(2, 5))


def setup_stealth_browser():
    """Setup browser with stealth configurations"""
    playwright = sync_playwright().start()
    
    # Use chromium with stealth args
    browser = playwright.firefox.launch(
        headless=True,  # Now we can use headless
        args=[
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-default-apps',
            '--disable-web-security',
            '--disable-features=TranslateUI',
            '--disable-ipc-flooding-protection',
            '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows',
            '--disable-component-extensions-with-background-pages',
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-client-side-phishing-detection',
            '--disable-default-apps',
            '--disable-hang-monitor',
            '--disable-popup-blocking',
            '--disable-prompt-on-repost',
            '--disable-sync',
            '--metrics-recording-only',
            '--no-default-browser-check',
            '--no-pings',
            '--password-store=basic',
            '--use-mock-keychain',
            '--disable-blink-features=AutomationControlled'
        ]
    )
    
    context = browser.new_context(
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        viewport={"width": 1920, "height": 1080},
        extra_http_headers={
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0'
        },
        java_script_enabled=True,
        permissions=[]
    )
    
    return playwright, browser, context


def handle_cloudflare_protection(page):
    """Handle Cloudflare protection if detected"""
    try:
        # Wait for potential Cloudflare challenge
        page.wait_for_selector("body", timeout=10000)
        
        # Check for Cloudflare challenge indicators
        if page.locator("text=Checking your browser").is_visible() or \
           page.locator("text=Just a moment").is_visible() or \
           page.locator("#cf-spinner-please-wait").is_visible():
            print("Detected Cloudflare challenge, waiting...")
            # Wait longer for Cloudflare to resolve
            page.wait_for_timeout(10000)
            page.wait_for_load_state("networkidle", timeout=30000)
            
        # Check for cookie consent
        if page.is_visible("button:has-text('Accept All Cookies')"):
            page.click("button:has-text('Accept All Cookies')")
            page.wait_for_load_state("networkidle")
            
    except Exception as e:
        print(f"Error handling Cloudflare protection: {e}")


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

    playwright_instance, browser, context = setup_stealth_browser()
    
    try:
        page = context.new_page()
        
        # Add stealth scripts to avoid detection
        page.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined,
            });
            
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5],
            });
            
            Object.defineProperty(navigator, 'languages', {
                get: () => ['en-US', 'en'],
            });
            
            window.chrome = {
                runtime: {},
            };
            
            Object.defineProperty(navigator, 'permissions', {
                get: () => ({
                    query: () => Promise.resolve({ state: 'granted' }),
                }),
            });
        """)

        for page_num in range(1, 16):
            src = url_template.format(page=page_num)
            print(f"Scraping list page {page_num}/15: {src}")

            try:
                # Navigate with extended timeout
                page.goto(src, wait_until="domcontentloaded", timeout=60000)
                
                # Handle Cloudflare and other protections
                handle_cloudflare_protection(page)
                
                # Wait for content to load
                page.wait_for_load_state("networkidle", timeout=30000)
                
                # Debug: Check if we're blocked
                page_title = page.title()
                page_content = page.content()
                
                if "blocked" in page_title.lower() or "captcha" in page_content.lower():
                    print(f"⚠️  Detected blocking on page {page_num}, adding delay...")
                    random_delay()
                    continue
                    
                print(f"✅ Successfully loaded page {page_num}")

                # Wait for listings to appear with multiple fallback selectors
                selectors_to_try = [
                    "div.card.result-card",
                    "h3.result-business-name",
                    "[data-testid='search-result']",
                    ".search-result"
                ]
                
                content_loaded = False
                for selector in selectors_to_try:
                    try:
                        page.wait_for_selector(selector, state="attached", timeout=15000)
                        content_loaded = True
                        break
                    except:
                        continue
                
                if not content_loaded:
                    print(f"⚠️  No content selectors found on page {page_num}")
                    # Debug: Save page content for inspection
                    with open(f"debug_page_{page_num}.html", "w", encoding="utf-8") as f:
                        f.write(page.content())
                    continue

                # Extract cards from the list page
                cards_data = extract_business_cards(page)
                print(f"Found {len(cards_data)} businesses on page {page_num}")
                
                for entry in cards_data:
                    key = (entry["name"], entry["phone"])
                    if key in seen:
                        continue

                    # —————— DETAIL PAGE SCRAPE ——————
                    detail = context.new_page()
                    try:
                        print(f"Scraping detail page: {entry['name']}")
                        detail.goto(entry["url"], wait_until="domcontentloaded", timeout=30000)
                        detail.wait_for_load_state("networkidle", timeout=20000)
                        detail.wait_for_selector("main", timeout=15000)

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
                        print(f"Detail page error for {entry['name']}: {e}")
                        entry["principal_contact"] = ""
                        entry["accreditation"] = "Unknown"
                        entry["address"] = ""
                    finally:
                        detail.close()

                    seen.add(key)
                    results.append(entry)
                    
                    # Random delay between detail page scrapes
                    random_delay()
                    
                print(f"Completed page {page_num}. Total businesses: {len(results)}")
                
                # Longer delay between list pages
                time.sleep(random.uniform(3, 7))
                
            except Exception as e:
                print(f"Error on page {page_num}: {e}")
                continue

    finally:
        browser.close()
        playwright_instance.stop()

    # —————— WRITE CSV ——————
    print(f"Writing {len(results)} results to CSV...")
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
    
    print(f"✅ Successfully scraped {len(results)} medical billing companies!")


if __name__ == "__main__":
    scrape_bbb()