import { BlogPosts } from 'app/components/posts'
import Image from 'next/image'
import fs from 'fs'
import path from 'path'

export default function Page() {
  const imagesDir = path.join(process.cwd(), '/public/images')
  const imageFiles = fs.readdirSync(imagesDir).filter(file => file.endsWith('_alpha_power_hard.gif'))
  // const imageFiles = fs.readdirSync(imagesDir).filter(file => file.endsWith('_alpha_progression_hard.png'))
  
  // only keep first three elements of imageFiles
  //imageFiles.length = 3

  return (
    <section>
      <h1 className="mb-8 text-2xl font-semibold tracking-tighter">
        CC-EEG Individual Reports
      </h1>
      <p className="mb-4">
        {`I'm a Vim enthusiast and tab advocate, finding unmatched efficiency in
        Vim's keystroke commands and tabs' flexibility for personal viewing
        preferences. This extends to my support for static typing, where its
        early error detection ensures cleaner code, and my preference for dark
        mode, which eases long coding sessions by reducing eye strain.`}
      </p>
      <div className="my-8">
        <BlogPosts />
      </div>
      <div className="grid grid-cols-5 gap-4">
        {imageFiles.map((file) => (
          <div key={file} className="relative w-full h-44">
            <Image
              src={`/images/${file}`}
              alt={file}
              layout="fill"
              objectFit="cover"
              // width={300}
              // height={300}
            />
          </div>
        ))}
      </div>
    </section>
  )
}
