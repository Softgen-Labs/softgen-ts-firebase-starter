import Head from 'next/head'

export default function Home() {
  return (
    <>
      <Head>
        <title>Hello World</title>
        <meta name="description" content="A simple Hello World page" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      
      <main className="flex items-center justify-center min-h-screen">
        <h1 className="text-4xl font-bold">Hello World</h1>
      </main>
    </>
  )
}
