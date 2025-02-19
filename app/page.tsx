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
    <section className="max-w-xl mx-auto">
      <h1 className="mb-8 text-2xl font-semibold tracking-tighter">
        CC-EEG Individual Reports
      </h1>
      <h2 className="mb-2 text-xl font-semibold tracking-tighter">Information for Study Participants</h2>
      <p className="mb-4">
        To access your individual report, please use the link provided via mail. If you have any questions, please contact alakmeh @ ifi dot uzh dot ch.
      </p>
      <video
        poster="/videos/all_alpha_power_hard.jpeg"
        id="background-video"
        preload="auto"
        autoPlay
        loop
        muted
        playsInline
        className="w-full h-full object-cover rounded-lg mb-8"
      >
        <source src="/videos/all_alpha_power_hard.mp4" type="video/mp4" />
        Your browser does not support the video tag.
      </video>
      <h2 className="mb-2 text-xl font-semibold tracking-tighter">Abstract</h2>
      <p className="mb-4 italic">
      The impact of graphical user interface (GUI) modes, specifically light (positive polarity) and dark (negative polarity), on cognitive processes remains to be a debated topic in Software Engineering and Human-Computer Interaction. While light mode is associated with improved readability in general reading tasks, dark mode has gained popularity among developers due to perceived comfort and aesthetics. However, objective cognitive effects of GUI modes during complex tasks like code comprehension are largely unexplored. 
      This study investigates how GUI mode and task difficulty influence cognitive load and brain activity during code comprehension. Using electroencephalography (EEG), we measured alpha, beta, and theta band power of 42 participants solving 24 Python code comprehension tasks of varying difficulty under alternating GUI modes. Our findings indicate that task difficulty significantly influences cognitive load, observing higher alpha and theta power during harder tasks. Temporal analysis revealed a progressive increase in alpha power, peaking near 70% of task completion, followed by a decline before completion. In contrast, GUI mode generally showed no significant effects on brain activity across tasks. However, during hard tasks, participants exhibited increased alpha power in central and centroparietal regions when using dark mode, suggesting a subtle additional cognitive burden under high mental effort for dark mode users. We suggest future research to integrate our and previous findings to achieve a holistic view of how the brain processes and comprehends code.
      </p>

      {/* <div className="grid grid-cols-5 gap-4">
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
      </div> */}
    </section>
  )
}
