import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/AppLayout";
import { ScannerProvider } from "@/contexts/ScannerContext";
import { PatternScannerProvider } from "@/contexts/PatternScannerContext";
import Dashboard from "./pages/Dashboard.tsx";
import CandlestickPatterns from "./pages/CandlestickPatterns.tsx";
import ChartPatterns from "./pages/ChartPatterns.tsx";
import MarketStructure from "./pages/MarketStructure.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <ScannerProvider>
          <PatternScannerProvider>
            <AppLayout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/candlestick-patterns" element={<CandlestickPatterns />} />
                <Route path="/chart-patterns" element={<ChartPatterns />} />
                <Route path="/market-structure" element={<MarketStructure />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </AppLayout>
          </PatternScannerProvider>
        </ScannerProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
