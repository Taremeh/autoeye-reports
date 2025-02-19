import { Accordion } from 'app/components/accordion';
import Image from 'next/image'


const dominantParticipantIds = ["70701", "80701", "90601", "120601", "130602", "200601", "200602", "240602", "250601", "270601"]

export default function Page({ params }) {
  // Destructure pid correctly
  //const { pid } = params;
  const participantId = params.slug;
  
  return (
    <>
      <h1 className="mb-8 text-2xl font-semibold tracking-tighter">
        CC-EEG Individual Report: <pre className='inline bg-gray-100 p-2 pb-1 pt-1'>P{participantId}</pre>
      </h1>

      <Accordion title="Information for Study Participants">
        <p className="mb-4">
          Below you can find your individual report. If some of the images seem to be incomplete, it might be due to the preprocessing of the data. We display the cleaned data, which might not be ideal to represent the entire trial if there was a lot of noise during the experiment (e.g., due to movement artifacts or poor electrode connectivity).
        </p>

        <h2 className="mb-2 text-xl font-semibold tracking-tighter capitalize">How to read the data</h2>
        <p className="mb-4">
          Below you can find your individual report. If some of the images seem to be incomplete, it might be due to the preprocessing of the data. We display the cleaned data, which might not be ideal to represent the entire trial if there was a lot of noise during the experiment (e.g., due to movement artifacts or poor electrode connectivity).
          <b className="block mt-2 capitalize">What is alpha power?</b>
          Alpha power refers to the strength (amplitude) of alpha waves in an electroencephalogram (EEG) recording. Alpha waves are brain oscillations with a frequency range of 8–12 Hz. Variations in alpha power can provide insights into levels of cognitive engagement, attentional focus, or neural inhibition, depending on the context.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-white mb-8 p-4 md:p-0">
          <div className="md:p-10 md:pt-5">
            <h3 className="text-lg font-semibold">Topographic Map</h3>
            <Image
              src={`/images/${participantId}_alpha_power_hard.gif`}
              alt="Alpha Power Topographic Map"
              width="0"
              height="0"
              sizes="100vw"
              className="w-full h-auto"
            />
            <p className='text-justify'>This animation is a topographic representation of your averaged alpha power progression per task (in this case over all <i>hard</i> tasks). The brighter (more yellow) the area, the higher the activation. We normalized the time s.t. every task starts at <pre className='inline'>0.0</pre> and ends at <pre className='inline'>1.0</pre>. Normalization is achieved by relative sampling over the raw brain activity.</p>
          </div>
          <div className="md:p-10 md:pt-5">
            <h3 className="text-lg font-semibold capitalize">Alpha power over time</h3>
            <Image
              src={`/images/${participantId}_alpha_progression_easy.png`}
              alt="Alpha Progression over entire Experiment"
              width="0"
              height="0"
              sizes="100vw"
              className="w-full h-auto md:mb-10 md:mt-3"
            />
            <p>These linecharts display your brain's alpha power over time. The higher the value, the higher the activation at a specific point in time. For the line charts we report the alpha power progression in absolute time (i.e., regular seconds), and average the power over all available datapoints at the specific point in time.</p>
          </div>
        </div>
      </Accordion>

      <h2 className="mb-2 text-xl font-semibold tracking-tighter capitalize">Your alpha power progression over the entire experiment</h2>
      <Image
        src={`/images/${participantId}_alpha_progression_total.png`}
        alt="Alpha Progression over entire Experiment"
        width="0"
        height="0"
        sizes="100vw"
        className="w-full h-auto"
      />
      <p className="mb-8">
        This linechart displays your brain's alpha power over the entire experiment. The higher the value, the higher the activation at a specific point in time. The darker the red background, the more difficult the task. In between the tasks no alpha power is reported as there were 30 seconds of rest between each task.
      </p>

      <h2 className="mb-2 text-xl font-semibold tracking-tighter capitalize">Your average alpha power progression per task</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div>
          <h3 className="text-lg font-semibold">Your Easy Tasks</h3>
          <Image
            src={`/images/${participantId}_alpha_progression_easy.png`}
            alt="Alpha Power Topographic Map"
            width="0"
            height="0"
            sizes="100vw"
            className="w-full h-auto"
          />
        </div>
        <div>
          <h3 className="text-lg font-semibold capitalize">Your Medium Tasks</h3>
          <Image
            src={`/images/${participantId}_alpha_progression_medium.png`}
            alt="Alpha Progression over entire Experiment"
            width="0"
            height="0"
            sizes="100vw"
            className="w-full h-auto"
          />
        </div>
        <div>
          <h3 className="text-lg font-semibold capitalize">Your Hard Tasks</h3>
          <Image
            src={`/images/${participantId}_alpha_progression_hard.png`}
            alt="Alpha Progression over entire Experiment"
            width="0"
            height="0"
            sizes="100vw"
            className="w-full h-auto"
          />
        </div>
      </div>

      <h2 className="mb-2 text-xl font-semibold tracking-tighter capitalize">Your Task Difficulty Topomaps</h2>
      <p className="mb-4">
        We investigated the impact of task difficulty on your brain's alpha power. Below you can find the topographic maps for easy and hard tasks, as well as the difference between the two.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div>
          <h3 className="text-lg font-semibold capitalize text-center">Easy Tasks</h3>
          <Image
            src={`/images/${participantId}_alpha_power_easy.gif`}
            alt="Alpha Power Topographic Map"
            width="0"
            height="0"
            sizes="100vw"
            className="w-full h-auto"
          />
        </div>
        <div>
          <h3 className="text-lg font-semibold capitalize text-center">Hard Tasks</h3>
          <Image
            src={`/images/${participantId}_alpha_power_hard.gif`}
            alt="Alpha Power Topographic Map"
            width="0"
            height="0"
            sizes="100vw"
            className="w-full h-auto"
          />
        </div>
        <div>
          <h3 className="text-lg font-semibold capitalize text-center">Delta Easy-Hard</h3>
          <Image
            src={`/images/${participantId}_alpha_power_difference.gif`}
            alt="Alpha Power Topographic Map"
            width="0"
            height="0"
            sizes="100vw"
            className="w-full h-auto"
          />
        </div>
      </div>

      <h2 className="mb-2 text-xl font-semibold tracking-tighter capitalize">Your GUI Mode Topomaps</h2>
      <p className="mb-4">
        We investigated the impact of the graphical user interface mode (GUI mode) on your brain's alpha power. Below you can find the topographic maps for dark and light mode, as well as the difference between the two.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div>
          <h3 className="text-lg font-semibold capitalize text-center">Dark Mode</h3>
          <Image
            src={`/images/${participantId}_alpha_power_hard_gui0.gif`}
            alt="Alpha Power Topographic Map"
            width="0"
            height="0"
            sizes="100vw"
            className="w-full h-auto"
          />
        </div>
        <div>
          <h3 className="text-lg font-semibold capitalize text-center">Light Mode</h3>
          <Image
            src={`/images/${participantId}_alpha_power_hard_gui1.gif`}
            alt="Alpha Power Topographic Map"
            width="0"
            height="0"
            sizes="100vw"
            className="w-full h-auto"
          />
        </div>
        <div>
          <h3 className="text-lg font-semibold capitalize text-center">Delta Dark-Light</h3>
          <Image
            src={`/images/${participantId}_alpha_power_difference_gui.gif`}
            alt="Alpha Power Topographic Map"
            width="0"
            height="0"
            sizes="100vw"
            className="w-full h-auto"
          />
        </div>
      </div>

      
      <div className="bg-gray-100 p-4 md:p-10">
        <h2 className="mb-2 text-xl font-semibold tracking-tighter capitalize">Which GUI Mode should you use?</h2>
        <p className="mb-4">
          We investigated the impact of the graphical user interface mode (GUI mode) on the brain's activity of all participants. Generally speaking, we found no significant effects of GUI mode on brain activity. However, during hard tasks, some participants exhibited increased alpha power in central and centroparietal regions when using dark mode, suggesting a subtle additional cognitive burden for difficult tasks while using dark mode.
        </p>
        {
          dominantParticipantIds.includes(participantId) ? (
            <p className="mb-4">
              <b>You are one of the participants who exhibited significantly increased alpha power</b> in central and centroparietal regions when using dark mode during hard tasks. This means that we found significant differences in your brain activity between the two GUI modes during the experiment. You could try using light mode to see if it might help you to focus better during difficult tasks.
            </p>
          ) : (
            <p className="mb-4">
              You <b>are not</b> one of the participants who exhibited significantly increased alpha power in central and centroparietal regions when using dark mode during hard tasks. This means that we could not find any significant differences in your brain activity between the two GUI modes during the experiment.
            </p>
          )
        }
      </div>

    </>
  )
}

const participantIds = [
  "10701", "240601", "110601", "240602", "110701", "250601",
  "120601", "250602", "130602", "250603", "140601", "260601",
  "140602", "260602", "140603", "270601", "180601", "270602",
  "180602", "270603", "180603", "280601", "180701", "280602",
  "190601", "280603", "190602", "40701", "190603", "40702",
  "200601", "70601", "200602", "70701", "210601", "80701",
  "220601", "90601", "230602"
];


// This function gets called at build time to ensure that paths are generated for all participants
export const generateStaticParams = () => participantIds.map(id => ({ slug: id }));
