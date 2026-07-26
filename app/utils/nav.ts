export type NavItem = { to: string; label: string; icon: string; group?: "daily" | "more" }

export const NAV_PRIMARY: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: "lucide:layout-dashboard", group: "daily" },
  { to: "/orders", label: "Orders", icon: "lucide:shopping-bag", group: "daily" },
  { to: "/picking", label: "Picking", icon: "lucide:clipboard-list", group: "daily" },
  { to: "/routing", label: "Routing", icon: "lucide:route", group: "daily" },
  { to: "/shops", label: "Shops (B2B)", icon: "lucide:store", group: "daily" },
  { to: "/purchases", label: "Buy from shops", icon: "lucide:shopping-cart", group: "daily" },
  { to: "/products", label: "Products", icon: "lucide:package", group: "daily" },
  { to: "/assortment", label: "Assortment", icon: "lucide:layers", group: "daily" },
  { to: "/pricing", label: "Pricing", icon: "lucide:tags", group: "daily" },
  { to: "/inventory", label: "Inventory", icon: "lucide:boxes", group: "daily" },
  { to: "/categories", label: "Categories", icon: "lucide:folder-tree", group: "daily" },
  { to: "/delivery", label: "Riders", icon: "lucide:bike", group: "daily" },
  { to: "/chats", label: "Live chat", icon: "lucide:messages-square", group: "daily" },
  { to: "/payments", label: "Payments & Credit", icon: "lucide:wallet", group: "daily" },
]

export const NAV_MORE: NavItem[] = [
  { to: "/customers", label: "Customers", icon: "lucide:users", group: "more" },
  { to: "/forecast", label: "Forecast", icon: "lucide:trending-up", group: "more" },
  { to: "/ai-bot", label: "AI bot & FAQs", icon: "lucide:bot", group: "more" },
  { to: "/offers", label: "Offers & Schemes", icon: "lucide:percent", group: "more" },
  { to: "/banners", label: "Banners", icon: "lucide:image", group: "more" },
  { to: "/invoices", label: "Invoices / GST", icon: "lucide:file-text", group: "more" },
  { to: "/reports", label: "Profit & Reports", icon: "lucide:chart-column", group: "more" },
  { to: "/returns", label: "Returns", icon: "lucide:rotate-ccw", group: "more" },
  { to: "/tickets", label: "Tickets", icon: "lucide:ticket", group: "more" },
  { to: "/services", label: "Microservices", icon: "lucide:server", group: "more" },
  { to: "/settings", label: "Settings", icon: "lucide:settings", group: "more" },
]
