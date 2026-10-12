import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { RouterProvider } from "react-router-dom";
import { Toaster } from "sonner";
import { ConfirmProvider } from "@/components/ui/confirm";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider, useTheme } from "@/providers/theme";
import { queryClient } from "./query-client";
import { router } from "./router";

function ThemedToaster() {
  const { resolved } = useTheme();
  return (
    <Toaster
      theme={resolved}
      position="bottom-right"
      closeButton
      toastOptions={{
        className: "!font-sans !rounded-lg !border-border !shadow-lg",
        style: { fontFamily: "var(--font-sans)" },
      }}
    />
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        {/* reducedMotion="user" : les animations de transformation sont coupées si l'OS le demande */}
        <MotionConfig reducedMotion="user" transition={{ duration: 0.2 }}>
          <TooltipProvider>
            <ConfirmProvider>
              <RouterProvider router={router} />
              <ThemedToaster />
            </ConfirmProvider>
          </TooltipProvider>
        </MotionConfig>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
