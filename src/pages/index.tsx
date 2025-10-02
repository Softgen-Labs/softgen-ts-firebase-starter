import React from "react";
import Head from "next/head";
import { Button } from "@/components/ui/button";

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

        <div className="max-w-4xl mx-auto space-y-8">
          <h1>Visual Editor: Button & Link Tests</h1>

          <section className="space-y-4 border p-6 rounded-lg">
            <h2>Basic HTML Buttons</h2>
            <div className="flex gap-4 flex-wrap">
              <button className="px-4 py-2 bg-blue-500 text-white rounded">
                Simple Button
              </button>
              <button className="px-4 py-2 bg-green-500 text-white rounded">
                <span>Button with Span</span>
              </button>
              <button className="px-4 py-2 bg-purple-500 text-white rounded flex items-center gap-2">
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                Button with Icon
              </button>
            </div>
          </section>

          <section className="space-y-4 border p-6 rounded-lg">
            <h2>Shadcn UI Buttons</h2>
            <div className="flex gap-4 flex-wrap">
              <Button variant="default">Default Button</Button>
              <Button variant="secondary">Secondary Button</Button>
              <Button variant="destructive">Destructive Button</Button>
              <Button variant="outline">Outline Button</Button>
              <Button variant="ghost">Ghost Button</Button>
              <Button variant="link">Link Button</Button>
            </div>
          </section>

          <section className="space-y-4 border p-6 rounded-lg">
            <h2>Links</h2>
            <div className="flex gap-4 flex-wrap">
              <a href="#" className="text-blue-600 underline">
                Simple Link
              </a>
              <a href="#" className="text-purple-600 font-bold">
                Styled Link
              </a>
              <a
                href="#"
                className="inline-flex items-center gap-2 text-green-600"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 7l5 5m0 0l-5 5m5-5H6"
                  />
                </svg>
                Link with Icon
              </a>
            </div>
          </section>

          <section className="space-y-4 border p-6 rounded-lg">
            <h2>Text Elements (for comparison)</h2>
            <p>Regular paragraph text - should be editable</p>
            <span className="block">Span text - should be editable</span>
            <label className="block">Label text - should be editable</label>
            <h3>Heading text - should be editable</h3>
          </section>

          <section className="space-y-4 border p-6 rounded-lg bg-yellow-50">
            <h2>Expected Behavior</h2>
            <ul className="list-disc list-inside space-y-2">
              <li>
                <strong>Hover:</strong> All elements should show blue dashed
                outline
              </li>
              <li>
                <strong>Click button/link:</strong> Should select and show
                editing popover
              </li>
              <li>
                <strong>Click text:</strong> Should start inline editing
                immediately
              </li>
              <li>
                <strong>Navigation blocked:</strong> Links should not navigate,
                buttons should not trigger default actions
              </li>
              <li>
                <strong>Icon buttons:</strong> Clicking icon inside button
                should still select the button
              </li>
            </ul>
          </section>
        </div>
      </main>
    </>
  );
}
