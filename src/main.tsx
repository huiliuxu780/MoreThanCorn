import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { ThemeProvider } from "next-themes"
import { TooltipProvider } from "@/components/ui/tooltip"
import { App } from "@/app"
import "@/index.css"
import "@xyflow/react/dist/style.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider
      attribute="data-theme"
      themes={["light", "dark", "light-parchment", "dark-parchment"]}
      defaultTheme="system"
      enableSystem
      storageKey="mtc-theme"
      disableTransitionOnChange
    >
      <BrowserRouter>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
)
