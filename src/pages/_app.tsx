import { ThemeProvider } from "@/contexts/ThemeProvider";
import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { Toaster } from "sonner";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <ThemeProvider
      enableSystem
      disableTransitionOnChange
      attribute="class"
      defaultTheme="system"
    >
      <Component {...pageProps} />
      <Toaster />
    </ThemeProvider>
  );
}
