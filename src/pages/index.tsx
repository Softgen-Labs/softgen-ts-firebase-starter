import React from "react";
import Head from "next/head";

export default function Home() {
  return (
    <>
      <Head>
        <title>Hello World</title>
        <meta name="description" content="Welcome to my app" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold text-foreground">Hello World</h1>
          <p className="text-lg text-muted-foreground">
            This is going to be your softgen app, start by describing your
            project.
          </p>
        </div>
      </main>
    </>
  );
}
