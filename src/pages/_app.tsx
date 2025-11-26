import { Toaster } from "@/components/ui/toaster";
import "@/styles/globals.css";
import type { AppProps } from "next/app";
import SEO from "@/components/SEO";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <SEO />
      <Component {...pageProps} />
      <Toaster />
    </>
  );
}
