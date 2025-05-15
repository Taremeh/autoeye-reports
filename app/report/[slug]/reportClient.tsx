'use client';

import { useEffect, useState, useRef } from 'react';

export default function ReportClient({ participantId }) {
  const [regions, setRegions] = useState([]);
  const [iaReportMapping, setIaReportMapping] = useState({});
  const [sessionLogEvents, setSessionLogEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  // Toggle states for filters.
  const [filterAccepted, setFilterAccepted] = useState(false);
  const [filterDwellTime, setFilterDwellTime] = useState(false);
  // Sorting option: "time" (ascending), "duration" (desc), or "dwelltime" (desc).
  const [sortOption, setSortOption] = useState("time");
  const videoRef = useRef(null);

  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch IAS file, HTML mapping JSON, IA report (txt), and Session log concurrently.
        const [iasRes, htmlRes, iaReportRes, sessionLogRes] = await Promise.all([
          fetch(`/${participantId}/output_${participantId}.ias`),
          fetch(`/${participantId}/html_${participantId}.json`),
          fetch(`/${participantId}/IA_Report_${participantId}.txt`),
          fetch(`/${participantId}/SessionLog_${participantId}.log`),
        ]);

        const iasText = await iasRes.text();
        const htmlMapping = await htmlRes.json();

        // IA report is now a UTF-8 text file
        const iaReportText = await iaReportRes.text();

        // Read and parse session log
        const sessionLogText = await sessionLogRes.text();
        const { offset, events } = parseSessionLog(sessionLogText);
        setSessionLogEvents(events);

        // Parse IA report into mapping
        const reportMapping = parseIAReport(iaReportText);
        setIaReportMapping(reportMapping);

        // Parse IAS file into regions
        const parsedRegions = parseIAS(iasText, htmlMapping);
        setRegions(parsedRegions);
      } catch (err) {
        console.error('Error fetching or parsing data:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [participantId]);

  /**
   * getGroupKey:
   * Normalizes a label (lowercase, trimmed) and extracts its root.
   */
  function getGroupKey(label) {
    const normalized = label.toLowerCase().trim();
    const match = normalized.match(/^autolabel_(\d+)/);
    return match ? `autolabel_${match[1]}` : normalized;
  }

  /**
   * isBaseVersion:
   * Returns true if the label is a base version (no extra underscore after the letter).
   */
  function isBaseVersion(label) {
    return /^autolabel_\d+[a-z]?$/.test(label.toLowerCase().trim());
  }

  /**
   * getSubKey:
   * For a base version like "autolabel_16a", returns the letter (e.g. "a").
   */
  function getSubKey(label) {
    const match = label.toLowerCase().trim().match(/^autolabel_\d+([a-z])?$/);
    return match ? (match[1] || '') : '';
  }

  /**
   * parseIAS:
   * Splits the IAS file into entries, groups them by their root label,
   * and combines HTML content (from base versions) for rendering.
   */
  function parseIAS(iasText, htmlMapping) {
    const lines = iasText.split('\n').filter(line => line.trim() !== '');
    const dataLines = lines[0].startsWith('#') ? lines.slice(1) : lines;
    const entries = [];
    dataLines.forEach((line, index) => {
      const parts = line.split('\t');
      if (parts.length < 9) return;
      const start = Math.abs(parseFloat(parts[0]));
      const end = Math.abs(parseFloat(parts[1]));
      const label = parts[8].trim();
      entries.push({ start, end, duration: end - start, label, groupKey: getGroupKey(label), order: index });
    });

    const groups = {};
    entries.forEach(entry => {
      const key = entry.groupKey;
      if (!groups[key]) {
        groups[key] = { groupKey: key, start: entry.start, end: entry.end, order: entry.order, baseEntries: [] };
      } else {
        groups[key].start = Math.min(groups[key].start, entry.start);
        groups[key].end = Math.max(groups[key].end, entry.end);
        groups[key].order = Math.min(groups[key].order, entry.order);
      }
      if (isBaseVersion(entry.label)) {
        groups[key].baseEntries.push(entry);
      }
    });

    const result = Object.values(groups).map(group => {
      let combinedHtml = '';
      if (group.baseEntries.length) {
        group.baseEntries.sort((a, b) => getSubKey(a.label).localeCompare(getSubKey(b.label)));
        combinedHtml = group.baseEntries.map(e => htmlMapping[e.label] || '').join('<br />');
      } else {
        const fallback = entries.find(e => e.groupKey === group.groupKey);
        combinedHtml = htmlMapping[fallback.label] || '';
      }
      return { groupKey: group.groupKey, start: group.start, end: group.end, duration: group.end - group.start, html: combinedHtml };
    });

    return result.sort((a, b) => a.start - b.start);
  }

  /**
   * parseIAReport:
   * Parses the tab-delimited IA report TXT and aggregates viewed status and dwell time.
   */
  function parseIAReport(reportText) {
    const lines = reportText.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) return {};

    const header = lines[0].replace(/^\uFEFF/, '').split('\t').map(h => h.trim().toLowerCase());
    const labelIdx = header.indexOf('ia_label');
    const fixCountIdx = header.indexOf('ia_fixation_count');
    const dwellIdx = header.indexOf('ia_dwell_time');
    if (labelIdx === -1 || fixCountIdx === -1) return {};

    const map = {};
    lines.slice(1).forEach(line => {
      const parts = line.split('\t').map(p => p.trim());
      if (parts.length <= fixCountIdx) return;
      const iaLabel = parts[labelIdx];
      const fixCount = parseFloat(parts[fixCountIdx]);
      const dwell = dwellIdx !== -1 ? parseFloat(parts[dwellIdx]) : 0;
      if (isNaN(fixCount)) return;
      const root = getGroupKey(iaLabel);
      if (!map[root]) map[root] = { viewed: false, dwellTime: 0 };
      if (fixCount > 0) map[root].viewed = true;
      map[root].dwellTime += isNaN(dwell) ? 0 : dwell;
    });
    return map;
  }

  /**
   * parseSessionLog:
   * Finds the screen-recording offset and extracts Tab key events.
   */
  function parseSessionLog(logText) {
    const lines = logText.split(/\r?\n/).filter(l => l.trim());
    let offset = null;
    for (const line of lines) {
      const parts = line.split('\t').map(p => p.trim());
      if (parts.length < 4) continue;
      if (parts[3].includes('Screen Recording: Starting component Screen Recording')) {
        offset = parseFloat(parts[1]);
        break;
      }
    }
    const events = [];
    if (offset != null) {
      for (const line of lines) {
        const parts = line.split('\t').map(p => p.trim());
        if (parts.length < 4) continue;
        const ts = parseFloat(parts[1]);
        if (ts < offset) continue;
        if (parts[3].includes('KeyDown [Tab] 9')) {
          events.push({ timestamp: ts, relative: ts - offset, message: parts[3] });
        }
      }
    }
    return { offset, events };
  }

  // Jump video to region start
  const handleRegionClick = startMs => {
    if (videoRef.current) {
      videoRef.current.currentTime = startMs / 1000;
      videoRef.current.play();
    }
  };

  // Apply filters
  const filteredRegions = regions.filter(r => {
    const accepted = sessionLogEvents.some(e => e.relative >= r.start && e.relative <= r.end);
    if (filterAccepted && !accepted) return false;
    const ia = iaReportMapping[r.groupKey] || { dwellTime: 0 };
    if (filterDwellTime && ia.dwellTime <= 0) return false;
    return true;
  });

  // Sort regions
  const sortedRegions = [...filteredRegions].sort((a, b) => {
    if (sortOption === 'time') return a.start - b.start;
    if (sortOption === 'duration') return b.duration - a.duration;
    if (sortOption === 'dwelltime') {
      const da = iaReportMapping[a.groupKey]?.dwellTime || 0;
      const db = iaReportMapping[b.groupKey]?.dwellTime || 0;
      return db - da;
    }
    return 0;
  });

  return (
    <div className="container mx-auto p-4">
      <h1 className="mb-8 text-2xl font-semibold tracking-tighter">
        AUTOEYE Individual Report:{' '}
        <span className="bg-gray-100 p-2 pb-1 pt-1">P{participantId}</span>
      </h1>

      {/* Filters */}
      <div className="mb-4">
        <label className="mr-4">
          <input type="checkbox" checked={filterAccepted} onChange={e => setFilterAccepted(e.target.checked)} /> Accepted
        </label>
        <label className="mr-4">
          <input type="checkbox" checked={filterDwellTime} onChange={e => setFilterDwellTime(e.target.checked)} /> Dwelltime &gt; 0
        </label>
        <label>
          Sort by:{' '}
          <select value={sortOption} onChange={e => setSortOption(e.target.value)} className="ml-2">
            <option value="time">Time (ascending)</option>
            <option value="duration">Duration (longest first)</option>
            <option value="dwelltime">Dwelltime (longest first)</option>
          </select>
        </label>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : (
        <div className="flex flex-col md:flex-row gap-4">
          <div className="w-full md:w-1/2">
            <video ref={videoRef} controls className="w-full h-auto border" src={`/${participantId}/Videos/screenrecording.mp4`}>Your browser does not support the video tag.</video>
          </div>
          <div className="w-full md:w-1/2 overflow-auto max-h-[80vh]">
            {sortedRegions.map((region, idx) => {
              const ia = iaReportMapping[region.groupKey] || { viewed: false, dwellTime: 0 };
              const accepted = sessionLogEvents.some(e => e.relative >= region.start && e.relative <= region.end);
              const style = ia.viewed ? 'bg-gray-200' : 'opacity-50';
              return (
                <div key={idx} className={`mb-4 border p-4 cursor-pointer hover:bg-gray-100 ${style}`} onClick={() => handleRegionClick(region.start)}>
                  <div className="meta mb-2 text-sm text-gray-600">
                    <strong>Label:</strong> {region.groupKey} | <strong>Start:</strong> {region.start} | <strong>End:</strong> {region.end} | <strong>Duration:</strong> {region.duration}ms | <strong>Dwelltime:</strong> {ia.dwellTime}ms {accepted && <span className="ml-2 font-bold text-green-600">ACCEPTED</span>}
                  </div>
                  <div className="region-content whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: region.html }} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
