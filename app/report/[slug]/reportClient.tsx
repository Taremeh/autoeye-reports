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
        // Fetch IAS file, HTML mapping JSON, IA report, and Session log concurrently.
        const [iasRes, htmlRes, iaReportRes, sessionLogRes] = await Promise.all([
          fetch(`/${participantId}/output_${participantId}.ias`),
          fetch(`/${participantId}/html_${participantId}.json`),
          fetch(`/${participantId}/IA_Report_${participantId}.xls`),
          fetch(`/${participantId}/SessionLog_${participantId}.log`)
        ]);
        const iasText = await iasRes.text();
        const htmlMapping = await htmlRes.json();
        
        // Decode IA report from UTF-16LE.
        const iaReportBuffer = await iaReportRes.arrayBuffer();
        const decoder = new TextDecoder('utf-16le');
        const iaReportText = decoder.decode(iaReportBuffer);

        // Read and parse session log.
        const sessionLogText = await sessionLogRes.text();
        const { offset, events } = parseSessionLog(sessionLogText);
        setSessionLogEvents(events);

        // Parse the IA report (aggregated by the normalized root label).
        const reportMapping = parseIAReport(iaReportText);
        setIaReportMapping(reportMapping);

        // Parse the IAS file to get the regions.
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
   * For example:
   *   "autolabel_19a"      => "autolabel_19"
   *   "autolabel_19b_3"    => "autolabel_19"
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
   * If no letter is present, returns an empty string.
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
      if (parts.length < 9) return; // skip invalid lines
      const start = Math.abs(parseFloat(parts[0]));
      const end = Math.abs(parseFloat(parts[1]));
      const label = parts[8].trim();
      entries.push({
        start,
        end,
        duration: Math.abs(end - start),
        label,
        groupKey: getGroupKey(label),
        order: index,
      });
    });

    const groups = {};
    entries.forEach(entry => {
      const key = entry.groupKey;
      if (!groups[key]) {
        groups[key] = {
          groupKey: key,
          start: entry.start,
          end: entry.end,
          order: entry.order,
          baseEntries: [],
        };
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
      if (group.baseEntries.length > 0) {
        group.baseEntries.sort((a, b) => {
          const subA = getSubKey(a.label);
          const subB = getSubKey(b.label);
          return subA.localeCompare(subB);
        });
        combinedHtml = group.baseEntries
          .map(entry => htmlMapping[entry.label] || '')
          .join('<br />');
      } else {
        const fallbackEntry = entries.find(e => e.groupKey === group.groupKey);
        combinedHtml = htmlMapping[fallbackEntry.label] || '';
      }
      return {
        groupKey: group.groupKey,
        start: group.start,
        end: group.end,
        // Compute duration based on the aggregated start and end times.
        duration: group.end - group.start,
        html: combinedHtml,
      };
    });

    result.sort((a, b) => a.start - b.start);
    return result;
  }

  /**
   * parseIAReport:
   * Parses the tab-delimited IA report file and aggregates data by the normalized root label.
   * It now also aggregates the dwell time from the "ia_dwell_time" column.
   * A region is considered "viewed" if any row sharing the same root has IA_FIXATION_COUNT > 0.
   */
  function parseIAReport(reportText) {
    const lines = reportText.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length < 2) return {};

    // Remove any BOM from the first header field.
    const headerLine = lines[0].replace(/^\uFEFF/, '');
    // Normalize header fields: lowercase and trim.
    const header = headerLine.split('\t').map(h => h.trim().toLowerCase());
    const labelIndex = header.indexOf("ia_label");
    const fixationIndex = header.indexOf("ia_fixation_count");
    const dwellTimeIndex = header.indexOf("ia_dwell_time");
    if (labelIndex === -1 || fixationIndex === -1) {
      console.error("Missing expected header fields in IA report");
      return {};
    }

    const mapping = {};
    lines.slice(1).forEach(line => {
      const parts = line.split('\t').map(p => p.trim());
      if (parts.length <= fixationIndex) return;
      const iaLabel = parts[labelIndex];
      const fixationCount = parseFloat(parts[fixationIndex]);
      const dwellTime = dwellTimeIndex !== -1 ? parseFloat(parts[dwellTimeIndex]) : 0;
      const root = getGroupKey(iaLabel);
      if (isNaN(fixationCount)) return;

      if (!mapping[root]) {
        // Initialize mapping for the root.
        mapping[root] = { viewed: false, dwellTime: 0 };
      }
      if (fixationCount > 0) {
        mapping[root].viewed = true;
      }
      mapping[root].dwellTime += isNaN(dwellTime) ? 0 : dwellTime;
    });
    return mapping;
  }

  /**
   * parseSessionLog:
   * Parses the SessionLog file (tab-delimited) to:
   * 1. Find the "Screen Recording: Starting component Screen Recording" event.
   * 2. Use its timestamp (second column) as the offset (i.e. time 0).
   * 3. Extract all "KeyDown [Tab] 9" events and compute their relative timestamp.
   */
  function parseSessionLog(logText) {
    const lines = logText.split(/\r?\n/).filter(line => line.trim() !== '');
    let offset = null;
    // First pass: find the offset.
    for (const line of lines) {
      const parts = line.split('\t').map(p => p.trim());
      if (parts.length < 4) continue;
      const message = parts[3];
      if (message.includes("Screen Recording: Starting component Screen Recording")) {
        offset = parseFloat(parts[1]);
        break;
      }
    }
    const events = [];
    if (offset !== null) {
      // Second pass: get TAB keydown events after the offset.
      for (const line of lines) {
        const parts = line.split('\t').map(p => p.trim());
        if (parts.length < 4) continue;
        const timestamp = parseFloat(parts[1]);
        if (timestamp < offset) continue;
        const relative = timestamp - offset;
        const message = parts[3];
        if (message.includes("KeyDown [Tab] 9")) {
          events.push({ timestamp, relative, message });
        }
      }
    }
    console.log({ offset, events });
    return { offset, events };
  }

  // Jump the video to the region's start time (ms converted to seconds)
  const handleRegionClick = (startMs) => {
    if (videoRef.current) {
      videoRef.current.currentTime = startMs / 1000;
      videoRef.current.play();
    }
  };

  // Filter regions based on the active filters.
  const filteredRegions = regions.filter(region => {
    const accepted = sessionLogEvents.some(
      ev => ev.relative >= region.start && ev.relative <= region.end
    );
    if (filterAccepted && !accepted) return false;
    const iaData = iaReportMapping[region.groupKey] || { dwellTime: 0 };
    if (filterDwellTime && iaData.dwellTime <= 0) return false;
    return true;
  });

  // Sort the filtered regions based on the selected sort option.
  const sortedRegions = [...filteredRegions].sort((a, b) => {
    if (sortOption === "time") {
      return a.start - b.start;
    } else if (sortOption === "duration") {
      return b.duration - a.duration;
    } else if (sortOption === "dwelltime") {
      const aDwell = (iaReportMapping[a.groupKey] && iaReportMapping[a.groupKey].dwellTime) || 0;
      const bDwell = (iaReportMapping[b.groupKey] && iaReportMapping[b.groupKey].dwellTime) || 0;
      return bDwell - aDwell;
    }
    return 0;
  });

  return (
    <div className="container mx-auto p-4">
      <h1 className="mb-8 text-2xl font-semibold tracking-tighter">
        AUTOEYE Individual Report:{' '}
        <span className="bg-gray-100 p-2 pb-1 pt-1">P{participantId}</span>
      </h1>

      {/* Filter Toggles */}
      <div className="mb-4">
        <label className="mr-4">
          <input
            type="checkbox"
            checked={filterAccepted}
            onChange={(e) => setFilterAccepted(e.target.checked)}
          />{' '}
          Accepted
        </label>
        <label className="mr-4">
          <input
            type="checkbox"
            checked={filterDwellTime}
            onChange={(e) => setFilterDwellTime(e.target.checked)}
          />{' '}
          Dwelltime &gt; 0
        </label>
        <label>
          Sort by:{' '}
          <select
            value={sortOption}
            onChange={(e) => setSortOption(e.target.value)}
            className="ml-2"
          >
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
          {/* Left: Video */}
          <div className="w-full md:w-1/2">
            <video
              ref={videoRef}
              controls
              className="w-full h-auto border"
              src={`/${participantId}/${participantId}.mp4`}
            >
              Your browser does not support the video tag.
            </video>
          </div>
          {/* Right: Regions */}
          <div className="w-full md:w-1/2 overflow-auto max-h-[80vh]">
            {sortedRegions.map((region, idx) => {
              const iaData = iaReportMapping[region.groupKey] || { viewed: false, dwellTime: 0 };
              const viewed = iaData.viewed;
              const dwellTime = iaData.dwellTime;
              const accepted = sessionLogEvents.some(
                ev => ev.relative >= region.start && ev.relative <= region.end
              );
              const regionStyle = viewed ? 'bg-gray-200' : 'opacity-50';
              return (
                <div
                  key={idx}
                  className={`mb-4 border p-4 cursor-pointer hover:bg-gray-100 ${regionStyle}`}
                  onClick={() => handleRegionClick(region.start)}
                >
                  <div className="meta mb-2 text-sm text-gray-600">
                    <strong>Label:</strong> {region.groupKey} |{' '}
                    <strong>Start:</strong> {region.start} |{' '}
                    <strong>End:</strong> {region.end} |{' '}
                    <strong>Duration:</strong> {region.duration}ms |{' '}
                    <strong>Dwelltime:</strong> {dwellTime}ms{' '}
                    {accepted && (
                      <span className="ml-2 font-bold text-green-600">ACCEPTED</span>
                    )}
                  </div>
                  <div
                    className="region-content whitespace-pre-wrap break-words"
                    dangerouslySetInnerHTML={{ __html: region.html }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
