import { BookOpen } from "lucide-react";

const BDR    = "1px solid rgba(0,180,255,0.12)";
const ACCENT = "#00b4ff";

export default function ManualPage() {
  return (
    <div
      className="pb-24"
      style={{ fontFamily: "Arial, sans-serif", color: "#e8f4ff", background: "#020810", minHeight: "100vh", margin: "0 -12px" }}
    >
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: "#040c18", borderBottom: BDR, padding: "16px 20px", display: "flex", alignItems: "center", gap: 10 }}>
        <BookOpen style={{ width: 20, height: 20, color: ACCENT }} />
        <span style={{ fontSize: "1.1rem", fontWeight: 900, background: "linear-gradient(135deg,#00b4ff,#0047ab)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
          📖 P.O.S. Pro — User Manual
        </span>
      </div>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 16px" }}>

        {/* Cover */}
        <div style={{ textAlign: "center", padding: "40px 0 36px", borderBottom: BDR }}>
          <div style={{ fontSize: "3.5rem", marginBottom: 12 }}>🛒</div>
          <h2 style={{ fontSize: "1.8rem", fontWeight: 900, background: "linear-gradient(135deg,#00b4ff,#0047ab)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", margin: "0 0 12px" }}>
            P.O.S. Pro
          </h2>
          <p style={{ fontSize: "0.9rem", color: "#5b8db8", maxWidth: 480, margin: "0 auto", lineHeight: 1.6 }}>
            Complete guide to running your business with P.O.S. Pro — every feature explained step by step.
          </p>
        </div>

        {/* TOC */}
        <div style={{ padding: "28px 0", borderBottom: BDR }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 900, color: ACCENT, marginBottom: 14 }}>Table of Contents</h3>
          <ol style={{ paddingLeft: 20, margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "6px 24px" }}>
            {[
              ["#m-login",     "Signing In & Account Roles"],
              ["#m-session",   "Opening & Closing a Session"],
              ["#m-register",  "POS Register — Taking Orders"],
              ["#m-cash",      "Cash Sales & Change"],
              ["#m-credit",    "Credit Sales (Charge to Tab)"],
              ["#m-products",  "Items (Product Catalog)"],
              ["#m-categories","Categories"],
              ["#m-stock",     "Stock Check"],
              ["#m-wallet",    "Wallet & Financial Overview"],
              ["#m-expenses",  "Recording Expenses"],
              ["#m-customers", "Customers (Credit Accounts)"],
              ["#m-cashiers",  "Staff Management"],
              ["#m-manager",   "Manager — Manage Page"],
              ["#m-summary",   "Summary Reports"],
              ["#m-billing",   "Billing & Extra Stores"],
              ["#m-multistore","Multiple Stores"],
              ["#m-profile",   "Profile & Settings"],
              ["#m-offline",   "Offline Mode"],
            ].map(([href, label], i) => (
              <li key={href} style={{ fontSize: "0.85rem", marginBottom: 2 }}>
                <a href={href} style={{ color: ACCENT, textDecoration: "none" }} onClick={e => {
                  e.preventDefault();
                  document.getElementById(href!.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}>
                  {i + 1}. {label}
                </a>
              </li>
            ))}
          </ol>
        </div>

        {[
          // ── 1. Signing In ──────────────────────────────────────────────
          {
            id: "m-login", icon: "🔐", title: "Signing In & Account Roles", section: "Section 1",
            cards: [
              {
                title: "👑 Owner",
                items: [
                  "Full access to all features",
                  "Manage staff, items, wallet",
                  "Summary reports & billing",
                  "Opens and closes sessions",
                ],
              },
              {
                title: "🧑‍💼 Cashier",
                items: [
                  "POS register & credit sales",
                  "View own wallet balance",
                  "Log expenses from wallet",
                  "No owner settings or reports",
                ],
              },
              {
                title: "📋 Manager",
                items: [
                  "Browse items & customers",
                  "Stock check access",
                  "Log business expenses",
                  "No billing or staff access",
                ],
              },
            ],
            steps: [
              ["Open the app", "Launch P.O.S. Pro in your browser or via the installed app."],
              ["Enter credentials", "Owners register on the sign-up tab. Cashiers and managers are created by the owner inside the app under Staff."],
              ["You land on your home screen", "Owners and cashiers open on the Store (register). Managers open on Items."],
            ],
            tip: "Forgot your password? Use the Forgot Password link on the login screen to reset via email.",
          },

          // ── 2. Session ────────────────────────────────────────────────
          {
            id: "m-session", icon: "🕐", title: "Opening & Closing a Session", section: "Section 2",
            intro: "Each business day starts by opening a session and ends by closing it. All sales, expenses, and cashier wallets are tracked per session.",
            steps: [
              ["Go to the Store tab", "Tap Store in the menu. If no session is open, you'll see an Open Store button."],
              ["Set the float amount", "Enter the starting cash amount in the drawer, then tap Confirm to open the session."],
              ["Cashiers can start selling", "Once the session is open all cashiers can take orders immediately."],
              ["Close the session", "The owner closes the session from the Store page at end of day. This locks session totals for reporting."],
            ],
          },

          // ── 3. POS Register ───────────────────────────────────────────
          {
            id: "m-register", icon: "🛒", title: "POS Register — Taking Orders", section: "Section 3",
            intro: "The register is the heart of P.O.S. Pro. Use it for every sale — cash or credit, in-store or on the go.",
            steps: [
              ["Browse by category", "Category tabs appear at the top of the register. Tap a tab to filter items."],
              ["Tap an item to add to cart", "For items with no variations, one tap adds 1 unit directly. The stock badge on the card counts down as you add."],
              ["Items with variations open a picker", "If a product has size or option variations (e.g. Small / Large), a modal opens so you choose the option and quantity before adding."],
              ["Adjust quantities in the cart", "Tap − on a card to decrease qty. Tap × to remove the item entirely. Tap the card again to add another."],
              ["Tap Place Order to check out", "Once the order is ready, tap Place Order at the bottom of the screen."],
            ],
            tip: "Tap Sort Item Order at the bottom of the product grid to rearrange item positions. Tap one card then tap another to swap them.",
          },

          // ── 4. Cash Sales ─────────────────────────────────────────────
          {
            id: "m-cash", icon: "💵", title: "Cash Sales & Change", section: "Section 4",
            steps: [
              ["Tap Place Order", "After building the order tap the Place Order button at the bottom."],
              ["Enter amount tendered", "Use the numpad to type what the customer hands you. Change is calculated instantly."],
              ["Tap Confirm Sale", "The sale is saved, stock is decremented, and the cashier's wallet is credited automatically."],
            ],
            tip: "You can optionally select a customer from the right panel before confirming. This logs the cash sale against their account history without affecting their credit balance.",
          },

          // ── 5. Credit Sales ───────────────────────────────────────────
          {
            id: "m-credit", icon: "💳", title: "Credit Sales (Charge to Tab)", section: "Section 5",
            steps: [
              ["Open checkout and choose Credit", "In the Place Order screen, tap Credit on the right panel and select a customer."],
              ["Select or create a customer", "Search existing accounts or tap + New Account to create one on the spot."],
              ["Tap Confirm", "The amount is charged to the customer's balance. No cash changes hands. Stock is decremented immediately."],
            ],
            tip: "Customers pay off their tab from the Customers section. Tap a customer → Add Payment.",
          },

          // ── 6. Items ──────────────────────────────────────────────────
          {
            id: "m-products", icon: "📦", title: "Items (Product Catalog)", section: "Section 6",
            intro: "Items is the product catalog. Owners and managers can add, edit, and organise products.",
            steps: [
              ["Tap Items in the menu", "Available to owners and managers."],
              ["Add or edit an item", "Set name, category, selling price, cost price, and starting stock quantity. Add a product photo optionally."],
              ["Add variations (optional)", "If a product comes in multiple sizes or options, add variations with individual prices. Customers pick an option at checkout."],
              ["Stock tracks automatically", "Every confirmed sale immediately decrements the stock count. The badge on each register card shows the remaining qty in real time."],
            ],
            tip: "Always set a cost price. Items with no cost price or no selling price are flagged on the register and cannot be added to orders.",
          },

          // ── 7. Categories ─────────────────────────────────────────────
          {
            id: "m-categories", icon: "🗂️", title: "Categories", section: "Section 7",
            intro: "Categories organise your items into tabs on the register. Owners manage categories from the menu.",
            steps: [
              ["Tap Categories in the menu", "Owners only. Lists all current categories."],
              ["Add a category", "Tap + Add Category, enter a name, and save. It appears as a tab on the register immediately."],
              ["Assign items to categories", "Edit any item in Items and select its category from the dropdown."],
            ],
            tip: "An 'All' tab always appears on the register showing every item regardless of category.",
          },

          // ── 8. Stock Check ────────────────────────────────────────────
          {
            id: "m-stock", icon: "📋", title: "Stock Check", section: "Section 8",
            intro: "Stock Check gives a full view of current inventory — quantities on hand, value, and low-stock alerts.",
            steps: [
              ["Tap Stock Check in the menu", "Available to owners and managers."],
              ["Review current quantities", "Each item shows its current stock count, selling price, cost price, and total stock value."],
              ["Update stock manually", "Tap an item to edit its stock quantity directly — use this when you restock."],
            ],
            tip: "Items with 5 or fewer units show a 'Low' badge on the register. Items at 0 are marked Out of Stock and cannot be added to orders.",
          },

          // ── 9. Wallet ─────────────────────────────────────────────────
          {
            id: "m-wallet", icon: "💰", title: "Wallet & Financial Overview", section: "Section 9",
            intro: "Every user has a wallet. Sales are credited automatically by the system — no manual entries needed.",
            cards: [
              {
                title: "👑 Owner Wallet",
                items: [
                  "Transactions tab: full history",
                  "Financials tab: live P&L",
                  "Today's sales & net profit",
                  "Total income, expenses, stock value",
                ],
              },
              {
                title: "🧑‍💼 Cashier Wallet",
                items: [
                  "Balance credited on every sale",
                  "Log expenses (deducted from balance)",
                  "Float used for expense shortfalls",
                  "Download transaction statement",
                ],
              },
            ],
            steps: [
              ["Tap Wallet in the menu", "See your current balance and full transaction history."],
              ["Owner Financials tab", "Shows today's sales, net profit, total income, total expenses, and estimated stock value — all update in real time as sales come in."],
              ["Clear cashier wallets", "Go to Staff, tap a cashier, and tap Clear to Owner to transfer their balance."],
              ["Download statement", "Tap Statement (owner) or the download icon (cashier) to export a PDF of all transactions."],
            ],
          },

          // ── 10. Expenses ─────────────────────────────────────────────
          {
            id: "m-expenses", icon: "🧾", title: "Recording Expenses", section: "Section 10",
            intro: "Expenses track costs against income for accurate profit reporting. The rules differ by role.",
            cards: [
              {
                title: "👑 Owner Expenses",
                items: [
                  "Wallet → Financials → Add Expense",
                  "Record-only — no balance deducted",
                  "Appears in Total Expenses card",
                  "Affects net profit calculation",
                ],
              },
              {
                title: "🧑‍💼 Cashier / Manager",
                items: [
                  "Wallet → Add Expense",
                  "Deducted from own wallet first",
                  "Remainder taken from session float",
                  "Blocked if total exceeds available funds",
                ],
              },
            ],
            steps: [
              ["Open the expense form", "Owner: Wallet → Financials → Add Expense. Cashier/Manager: Wallet → Add Expense."],
              ["Add lines", "Each line has a description and amount. Tap + Add Line to add more for a bulk expense."],
              ["Tap Save then Confirm Save", "The expense is recorded immediately and appears in reports."],
            ],
          },

          // ── 11. Customers ─────────────────────────────────────────────
          {
            id: "m-customers", icon: "👤", title: "Customers (Credit Accounts)", section: "Section 11",
            intro: "Customers tracks who owes what. Any sale charged to a customer's tab shows up here.",
            steps: [
              ["Tap Customers in the menu", "Lists all credit accounts with their current balance owed."],
              ["View history", "Tap a customer to see every charge and payment, with dates and amounts."],
              ["Record a payment", "Tap Add Payment, enter the amount paid, and confirm. Balance updates immediately."],
              ["Download a bill", "Tap Bill to generate a PDF statement to share with the customer."],
            ],
          },

          // ── 12. Staff ─────────────────────────────────────────────────
          {
            id: "m-cashiers", icon: "👥", title: "Staff Management", section: "Section 12",
            intro: "Owners manage all cashier and manager accounts from the Staff page.",
            steps: [
              ["Tap Staff in the menu", "Owner only. Lists all active staff accounts."],
              ["Add a cashier", "Tap Add Cashier, set a username and password. They can log in immediately after creation."],
              ["Add a manager", "Same as adding a cashier but set the job title to Manager. Managers see Items, Stock Check, Customers, and the Manage expense page."],
              ["Manage a staff member", "Tap any staff card to view their wallet balance, clear it to the owner, or suspend their account."],
            ],
            tip: "Cashiers only see Store, Customers, and their own Wallet. They cannot access Items, Staff, Summary, Billing, or owner reports.",
          },

          // ── 13. Manager page ──────────────────────────────────────────
          {
            id: "m-manager", icon: "📊", title: "Manager — Manage Page", section: "Section 13",
            intro: "The Manage page is the manager's dashboard for logging business expenses on behalf of the owner.",
            steps: [
              ["Log in as a manager", "Managers are created by the owner in Staff with the job title set to Manager."],
              ["Tap Manage in the menu", "Opens the expense entry form."],
              ["Add expense lines and confirm", "Enter description and amount for each cost item. Tap Save then Confirm Save. The expense appears in the owner's Summary reports."],
            ],
            tip: "Manager expenses deduct from the manager's own wallet balance first. If the wallet balance is insufficient, the remainder comes from the session float.",
          },

          // ── 14. Summary ───────────────────────────────────────────────
          {
            id: "m-summary", icon: "📊", title: "Summary Reports", section: "Section 14",
            intro: "Summary gives owners a full financial breakdown — by session, today, or any custom date range.",
            steps: [
              ["Tap Summary in the menu", "Owner only. Loads the report for the current session by default."],
              ["Switch time period", "Toggle between Session, Today, and All Time. Use date pickers for a custom range."],
              ["Read the breakdown", "See total sales, cost of goods sold, gross profit, expenses, and net profit. Cashier performance is listed below."],
              ["Download PDF", "Tap the PDF icon to export the full summary for the selected period."],
            ],
          },

          // ── 15. Billing ───────────────────────────────────────────────
          {
            id: "m-billing", icon: "💳", title: "Billing & Extra Stores", section: "Section 15",
            intro: "P.O.S. Pro is $1,800 TT/yr per store. Each additional store location costs $1,200 TT/yr, pro-rated to your renewal date.",
            steps: [
              ["Tap Billing in the menu", "View subscription status, renewal date, and full payment history."],
              ["Renew your plan", "The Renew button appears 7 days before your due date. Submit payment by cash or bank transfer."],
              ["Add an extra store", "Tap Add New Store, enter the store name and location. The price is pro-rated to your existing renewal date."],
              ["Wait for admin approval", "Admin confirms your payment and activates the extra store. You'll receive a notification when it's live."],
            ],
            tip: "All stores renew together on the same date. One payment covers your main plan plus all extra stores.",
          },

          // ── 16. Multiple Stores ───────────────────────────────────────
          {
            id: "m-multistore", icon: "🏪", title: "Multiple Stores", section: "Section 16",
            intro: "If you have more than one store location, you switch between them from the menu. Each store has its own separate inventory, cashiers, wallet, and transaction history.",
            steps: [
              ["Tap Switch Store in the menu", "Shows all your active store locations."],
              ["Select a store", "Tap the store you want to manage. The app switches context — all data (register, wallet, reports) now belongs to that store."],
              ["Add more stores", "Go to Billing → Add New Store. New stores are activated after payment is confirmed by admin."],
            ],
            tip: "The active store name shows in the header under P.O.S. Pro so you always know which location you're managing.",
          },

          // ── 17. Profile ───────────────────────────────────────────────
          {
            id: "m-profile", icon: "⚙️", title: "Profile & Settings", section: "Section 17",
            steps: [
              ["Tap Profile in the menu", "Owner only. Update your business name, contact details, and account info."],
              ["Change your password", "Enter your current password, then the new password and confirm it."],
              ["Switch language", "Tap Language in the menu to switch the app between English and Spanish."],
            ],
          },

          // ── 18. Offline ───────────────────────────────────────────────
          {
            id: "m-offline", icon: "📡", title: "Offline Mode", section: "Section 18",
            intro: "P.O.S. Pro is a cloud-connected app. A stable internet connection is required for all live features.",
            warning: "Sales, wallet updates, stock, and reports all require an active connection. Use reliable Wi-Fi or mobile data at your business location.",
            tip: "Add P.O.S. Pro to your home screen (Add to Home Screen in your browser) for a native-app feel and faster startup times.",
          },
        ].map((s: any) => (
          <Section key={s.id} {...s} />
        ))}
      </div>
    </div>
  );
}

function Section({ id, icon, title, section, intro, cards, steps, tip, warning }: {
  id: string; icon: string; title: string; section: string;
  intro?: string; cards?: { title: string; items: string[] }[];
  steps?: [string, string][]; tip?: string; warning?: string;
}) {
  return (
    <div id={id} style={{ padding: "32px 0", borderBottom: "1px solid rgba(0,180,255,0.10)", scrollMarginTop: 60 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, background: "rgba(0,180,255,0.10)", border: "1px solid rgba(0,180,255,0.22)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.3rem" }}>
          {icon}
        </div>
        <div>
          <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 900, color: "#e8f4ff" }}>{title}</h3>
          <span style={{ fontSize: "0.75rem", color: ACCENT, fontWeight: 700, opacity: 0.7 }}>{section}</span>
        </div>
      </div>
      {intro && <p style={{ fontSize: "0.875rem", color: "#5b8db8", marginBottom: 16, lineHeight: 1.6 }}>{intro}</p>}
      {cards && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
          {cards.map(card => (
            <div key={card.title} style={{ background: "rgba(0,180,255,0.06)", border: "1px solid rgba(0,180,255,0.15)", borderRadius: 14, padding: "14px 16px" }}>
              <h4 style={{ margin: "0 0 8px", fontSize: "0.85rem", fontWeight: 900, color: ACCENT }}>{card.title}</h4>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {card.items.map(item => (
                  <li key={item} style={{ fontSize: "0.8rem", color: "#a0c4e0", marginBottom: 4, lineHeight: 1.4 }}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {steps && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: tip || warning ? 16 : 0 }}>
          {steps.map(([stepTitle, stepBody], i) => (
            <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0, background: "linear-gradient(135deg,#00b4ff,#0047ab)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: 900, color: "#000d1a" }}>
                {i + 1}
              </div>
              <div style={{ paddingTop: 4 }}>
                <h4 style={{ margin: "0 0 3px", fontSize: "0.875rem", fontWeight: 800, color: "#e8f4ff" }}>{stepTitle}</h4>
                <p style={{ margin: 0, fontSize: "0.82rem", color: "#5b8db8", lineHeight: 1.55 }}>{stepBody}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {warning && (
        <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 12, padding: "12px 14px", marginBottom: tip ? 10 : 0, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span style={{ fontSize: "1rem", flexShrink: 0 }}>⚠️</span>
          <p style={{ margin: 0, fontSize: "0.82rem", color: "#f4a0a0", lineHeight: 1.55 }}>{warning}</p>
        </div>
      )}
      {tip && (
        <div style={{ background: "rgba(0,180,255,0.07)", border: "1px solid rgba(0,180,255,0.20)", borderRadius: 12, padding: "12px 14px", display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span style={{ fontSize: "1rem", flexShrink: 0 }}>💡</span>
          <p style={{ margin: 0, fontSize: "0.82rem", color: "#5b8db8", lineHeight: 1.55 }}>{tip}</p>
        </div>
      )}
    </div>
  );
}
