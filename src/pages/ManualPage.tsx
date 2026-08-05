import { BookOpen } from "lucide-react";

// Section colour tokens — blue theme
const BDR  = "1px solid rgba(0,180,255,0.12)";
const ACCENT = "#00b4ff";
const CARD_BG = "rgba(0,180,255,0.06)";
const CARD_BORDER = "1px solid rgba(0,180,255,0.18)";

export default function ManualPage() {
  return (
    <div
      className="pb-24"
      style={{ fontFamily: "Arial, sans-serif", color: "#e8f4ff", background: "#020810", minHeight: "100vh", margin: "0 -12px" }}
    >
      {/* Header */}
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
            The complete guide to running your business with P.O.S. Pro — any on-the-go sale or in-store point of sale, every feature explained step by step.
          </p>
        </div>

        {/* TOC */}
        <div style={{ padding: "28px 0", borderBottom: BDR }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 900, color: ACCENT, marginBottom: 14 }}>Table of Contents</h3>
          <ol style={{ paddingLeft: 20, margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "6px 24px" }}>
            {[
              ["#m-login",    "Signing In & Account Roles"],
              ["#m-session",  "Opening & Closing a Session"],
              ["#m-pos",      "POS Register — Taking Orders"],
              ["#m-cash",     "Cash Sales & Change"],
              ["#m-credit",   "Credit Sales (Charge to Tab)"],
              ["#m-bottles",  "Opened Bottles & Drink Sales"],
              ["#m-packs",    "Cigarette & Rolling Paper Packs"],
              ["#m-specials", "Specials & Bundle Deals"],
              ["#m-products", "Items (Product Catalog)"],
              ["#m-wallet",   "Wallet & Financial Overview"],
              ["#m-customers","Customers (Credit Accounts)"],
              ["#m-cashiers", "Staff (Cashiers)"],
              ["#m-manager",  "Manager — Business Expense"],
              ["#m-music",    "Music Player"],
              ["#m-summary",  "Summary Reports"],
              ["#m-billing",  "Billing & Extra Stores"],
              ["#m-profile",  "Profile & Settings"],
              ["#m-offline",  "Offline Mode & Sync"],
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

        {/* Sections */}
        {[
          {
            id: "m-login", icon: "🔐", title: "Signing In & Account Roles", section: "Section 1",
            cards: [
              { title: "👑 Owner", items: ["Full access to all features","Manage staff, products, wallet","View all reports and history","Billing and plan management"] },
              { title: "🧑‍💼 Cashier", items: ["Take orders at the register","Cash and credit sales","View own wallet balance","No access to owner settings"] },
              { title: "📋 Manager", items: ["Record business expenses","View items and customers","Stock check access","No billing or staff management"] },
            ],
            steps: [
              ["Open the app","Launch P.O.S. Pro in your browser or via the installed APK."],
              ["Enter your username and password","Owners register first. Cashiers and managers are created by the owner inside the app."],
              ["You land on your home screen","Owners and cashiers go to the POS register. Managers go to Items."],
            ],
            tip: "Forgot your password? Use the Forgot Password link on the login page to reset via email.",
          },
          {
            id: "m-session", icon: "🕐", title: "Opening & Closing a Session", section: "Section 2",
            intro: "Each business day starts with opening a session and ends with closing it. Cashier wallets are tracked per session.",
            steps: [
              ["Open the Register tab","Tap Register in the menu. If no session is open you'll see the Open Session button."],
              ["Set the cashier float","Enter the starting cash amount for the session, then confirm to open."],
              ["Start selling","Once open, cashiers can take orders immediately. All sales are logged in real time."],
              ["Close the session (owner)","At end of day the owner closes the session from the Wallet page. This locks the session totals."],
            ],
          },
          {
            id: "m-pos", icon: "🛒", title: "POS Register — Taking Orders", section: "Section 3",
            intro: "Use for any on-the-go sale or in-store point of sale. Works for any type of business.",
            steps: [
              ["Tap items to add to cart","Browse by category tabs at the top. Tap any product to add one unit to the cart."],
              ["Adjust quantities","Long-press an item in the cart to change its quantity or remove it."],
              ["Choose cash or credit","Tap Cash Sale or Credit Sale to proceed to checkout."],
            ],
            tip: "Sort items by long-pressing the product grid to enter sort mode. Tap an item then tap another to swap positions.",
          },
          {
            id: "m-cash", icon: "💵", title: "Cash Sales & Change", section: "Section 4",
            steps: [
              ["Tap Cash Sale","After building the order, tap the Cash Sale button at the bottom of the cart."],
              ["Enter amount tendered","Type in the amount the customer gives you. The app calculates change instantly."],
              ["Confirm the sale","Tap Confirm. The sale is recorded and the cashier wallet is updated."],
            ],
          },
          {
            id: "m-credit", icon: "💳", title: "Credit Sales (Charge to Tab)", section: "Section 5",
            steps: [
              ["Tap Credit Sale","Select Credit Sale from the cart. You'll be prompted to choose a customer."],
              ["Select or create a customer","Search existing credit accounts or tap + New Account to create one on the spot."],
              ["Confirm charge","The amount is added to that customer's outstanding balance. No cash changes hands."],
            ],
            tip: "Customers can pay off their tab later from the Customers section. Tap a customer then Add Payment.",
          },
          {
            id: "m-bottles", icon: "🥃", title: "Opened Bottles & Drink Sales", section: "Section 6",
            intro: "Sell individual shots from an opened bottle without reducing stock on the full-bottle product.",
            steps: [
              ["Tap the 🥃 bottle icon on the register","Opens the bottle selector to sell individual shots."],
              ["Choose a product","Select the open bottle. The shot price is set per product in your Items catalog."],
              ["Add to order","Tap Add Shot. It appears in the cart like any other item."],
            ],
          },
          {
            id: "m-packs", icon: "🚬", title: "Cigarette & Rolling Paper Packs", section: "Section 7",
            intro: "Sell individual units from an open pack without tracking as a full-unit sale.",
            steps: [
              ["Tap the 🚬 icon on the register","Opens the retail singles selector."],
              ["Select the product and quantity","Choose which pack is open and how many singles to sell."],
              ["Add to order and complete sale","Items appear in the cart and go through normal checkout."],
            ],
          },
          {
            id: "m-specials", icon: "🎁", title: "Specials & Bundle Deals", section: "Section 8",
            intro: "Create deals that combine multiple products at a single bundle price.",
            steps: [
              ["Go to Specials","Owners tap Specials in the menu to manage deals."],
              ["Create a new special","Name the deal, set the bundle price, and add the products it includes."],
              ["Cashiers sell specials from the register","Specials appear in the product grid like any item."],
            ],
          },
          {
            id: "m-products", icon: "📦", title: "Items (Product Catalog)", section: "Section 9",
            steps: [
              ["Tap Items in the menu","Only owners and managers can access this section."],
              ["Add or edit a product","Set the name, category, selling price, cost price, and stock level. Optionally add a photo."],
              ["Stock is tracked automatically","Every confirmed sale deducts from stock. Low-stock indicators appear when levels drop."],
            ],
            tip: "Set a cost price to see your profit margin per product in the Summary report.",
          },
          {
            id: "m-wallet", icon: "💰", title: "Wallet & Financial Overview", section: "Section 10",
            intro: "Every owner and cashier has a wallet. Cash sales go to the cashier's wallet. Owners can transfer funds to their own wallet.",
            steps: [
              ["View balance and records","Tap Wallet in the menu to see your running balance and full transaction history."],
              ["Clear cashier wallets","Go to Staff, select a cashier, and tap Clear to Owner to transfer their balance."],
              ["Download statement","Tap Statement in the wallet to generate a PDF of all transactions."],
            ],
          },
          {
            id: "m-customers", icon: "👤", title: "Customers (Credit Accounts)", section: "Section 11",
            steps: [
              ["Go to Customers","Tap Customers in the menu to see all credit accounts."],
              ["View balance and history","Tap a customer to see their full charge and payment history and current balance."],
              ["Record a payment","Tap Add Payment, enter the amount, and confirm. The balance updates immediately."],
              ["Download a bill","Tap Bill to generate a PDF statement to share with the customer."],
            ],
          },
          {
            id: "m-cashiers", icon: "👥", title: "Staff (Cashiers)", section: "Section 12",
            steps: [
              ["Tap Staff in the menu","Only the owner can manage staff accounts."],
              ["Add a cashier","Tap Add Cashier, set a username and password. They can log in immediately."],
              ["Clear or suspend a cashier","Tap a cashier card to transfer their wallet balance or suspend their access."],
            ],
            tip: "Cashiers only see the register and their own wallet. They cannot access owner settings, reports, or products.",
          },
          {
            id: "m-manager", icon: "📋", title: "Manager — Business Expense", section: "Section 13",
            intro: "The Manager role is for recording business supply expenses — stock purchases, utilities, and other costs.",
            steps: [
              ["Log in as manager","Managers are created by the owner in the Staff section with job title set to Manager."],
              ["Open Business Expense","Tap Manage in the menu to record a new expense with category, amount, and note."],
              ["Owner reviews in Summary","All manager-logged expenses appear in the owner's Summary report under the Expenses tab."],
            ],
          },
          {
            id: "m-music", icon: "🎵", title: "Music Player", section: "Section 14",
            intro: "Built-in YouTube music player — search and queue songs without leaving the app.",
            steps: [
              ["Tap Music in the menu","The music player opens. Search YouTube for any song or playlist."],
              ["Queue tracks","Tap a result to play it. Previous tracks are saved in history so you can replay them."],
              ["Music keeps playing while you work","Navigate to the register or any other page — music continues in the background."],
            ],
          },
          {
            id: "m-summary", icon: "📊", title: "Summary Reports", section: "Section 15",
            intro: "Owners get a full financial overview — sales, expenses, profits, and cashier breakdowns.",
            steps: [
              ["Tap Summary","Available to owners only. Shows totals for the current and previous sessions."],
              ["Filter by date range","Use the date pickers to see data for any custom period."],
              ["Download PDF","Tap the download icon to export the full summary report as a PDF."],
            ],
          },
          {
            id: "m-billing", icon: "💳", title: "Billing & Extra Stores", section: "Section 16",
            intro: "P.O.S. Pro is $1,800 TT/yr. Each additional store location costs $1,200 TT/yr, pro-rated to your renewal date.",
            steps: [
              ["Tap Billing in the menu","View your subscription status, renewal date, and payment history."],
              ["Renew your plan","Renewal opens 7 days before your due date. Submit cash or bank transfer payment."],
              ["Add a new store","Tap Add New Store, enter the store name and location. Price is pro-rated to your renewal."],
              ["Switch between stores","Once approved, extra stores appear in Switch Store in the menu."],
            ],
            tip: "All extra stores renew together with your main plan on the same date — one payment covers everything.",
          },
          {
            id: "m-profile", icon: "⚙️", title: "Profile & Settings", section: "Section 17",
            steps: [
              ["Tap Profile","Update your business name, contact details, and change your password."],
              ["Change password","Enter your current password, then your new password and confirm it."],
              ["Language","Switch the app between English and Spanish from the Language option in the menu."],
            ],
          },
          {
            id: "m-offline", icon: "📡", title: "Offline Mode & Sync", section: "Section 18",
            intro: "P.O.S. Pro requires an internet connection for all real-time features.",
            warning: "An active connection is required for sales, wallets, and reports. Use a stable Wi-Fi or mobile data connection at your business.",
            tip: "Install the app as a PWA (Add to Home Screen in your browser) for a native-app feel and faster load times.",
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
          <span style={{ fontSize: "0.75rem", color: "#00b4ff", fontWeight: 700, opacity: 0.7 }}>{section}</span>
        </div>
      </div>
      {intro && <p style={{ fontSize: "0.875rem", color: "#5b8db8", marginBottom: 16, lineHeight: 1.6 }}>{intro}</p>}
      {cards && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
          {cards.map(card => (
            <div key={card.title} style={{ background: "rgba(0,180,255,0.06)", border: "1px solid rgba(0,180,255,0.15)", borderRadius: 14, padding: "14px 16px" }}>
              <h4 style={{ margin: "0 0 8px", fontSize: "0.85rem", fontWeight: 900, color: "#00b4ff" }}>{card.title}</h4>
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
