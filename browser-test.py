import sys
import os
from playwright.sync_api import sync_playwright

def run_test():
    print("🚀 Starting Playwright Browser Test...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()
        
        url = "http://localhost:3000"
        print(f"🔗 Navigating to {url}...")
        
        try:
            page.goto(url)
            print("⏳ Waiting for page load (networkidle)...")
            page.wait_for_load_state('networkidle')
            
            # Check for Loading state first
            if "Loading LocalChat..." in page.content():
                print("⏳ Page is in loading state. Waiting a bit more...")
                page.wait_for_timeout(5000) # Wait for potential redirects or auth checks
            
            print("📸 Taking screenshot of the landing page...")
            page.screenshot(path='landing_page.png')
            
            print("🔍 Inspecting page content...")
            content = page.content()
            
            if "Join LocalChat" in content:
                print("✅ Found 'Join LocalChat' screen. Auth component is working.")
            elif "Welcome to LocalChat" in content:
                print("✅ Found 'Welcome to LocalChat' screen. Username setup is working.")
            elif "Chats" in content:
                print("✅ Found 'Chats' sidebar. Main application is working.")
            else:
                print("⚠️ Unexpected content found. Printing page title and snippet:")
                print(f"Title: {page.title()}")
                # Print a small snippet of the body to see what's there
                body_text = page.inner_text('body')
                print(f"Body snippet: {body_text[:200]}...")
            
        except Exception as e:
            print(f"❌ Error during browser test: {e}")
        finally:
            browser.close()
            print("🛑 Browser closed.")

if __name__ == "__main__":
    run_test()
