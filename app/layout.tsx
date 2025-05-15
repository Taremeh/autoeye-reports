import './global.css'
import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { Navbar } from './components/nav'
import Footer from './components/footer'

export const metadata: Metadata = {
  metadataBase: new URL("https://cc-eeg.alakmeh.ch"),
  title: {
    default: 'CC-EEG Individual Reports',
    template: '%s | CC-EEG Individual Reports',
  },
  description: 'CC-EEG Individual Reports',
  openGraph: {
    title: 'CC-EEG Individual Reports',
    description: 'CC-EEG Individual Reports',
    url: 'https://cc-eeg.alakmeh.ch',
    siteName: 'CC-EEG Individual Reports',
    locale: 'en_US',
    type: 'website',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
}

const cx = (...classes) => classes.filter(Boolean).join(' ')

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={cx(
        //'text-black bg-white dark:text-white dark:bg-black', // dark mode
        'text-black bg-white p-0 px-0', // light mode
        GeistSans.variable,
        GeistMono.variable
      )}

    >
      <body className="antialiased max-w-full m-0 lg:mx-auto">
        <main className="flex-auto min-w-0 flex flex-col px-2 md:px-0">
          {/* <Navbar /> */}
          {children}
          {/* <Footer /> */}
        </main>
      </body>
    </html>
  )
}
