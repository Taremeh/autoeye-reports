'use client';

import { useEffect, useState, useRef, useMemo } from 'react';

export default function ReportClient({ participantId }) {
  const [regions, setRegions] = useState([]);
  const [iaReportMapping, setIaReportMapping] = useState({});
  const [sessionLogEvents, setSessionLogEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [videoDuration, setVideoDuration] = useState(0);

  // Toggle states for filters.
  const [filterAccepted, setFilterAccepted] = useState(false);
  const [filterDwellTime, setFilterDwellTime] = useState(false);
  // Threshold filters (ms)
  const [durationThreshold, setDurationThreshold] = useState('');
  const [dwellThreshold, setDwellThreshold] = useState('');

  // Sorting option: "time" (ascending), "duration" (desc), "dwelltime" (desc), or "suggestionLength" (desc).
  const [sortOption, setSortOption] = useState("time");
  const videoRef = useRef(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [iasRes, htmlRes, iaReportRes, sessionLogRes] = await Promise.all([
          fetch(`/${participantId}/output_${participantId}.ias`),
          fetch(`/${participantId}/html_${participantId}.json`),
          fetch(`/${participantId}/IA_Report_${participantId}.txt`),
          fetch(`/${participantId}/SessionLog_${participantId}.log`),
        ]);

        const iasText = await iasRes.text();
        const htmlMapping = await htmlRes.json();
        const iaReportText = await iaReportRes.text();
        const sessionLogText = await sessionLogRes.text();

        const { offset, events } = parseSessionLog(sessionLogText);
        setSessionLogEvents(events);

        const reportMapping = parseIAReport(iaReportText);
        setIaReportMapping(reportMapping);

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

  const fullDuration = useMemo(() => {
    if (!regions.length) return 0;
    return Math.max(...regions.map(r => r.end));
  }, [regions]);
  const timelineDuration = videoDuration || fullDuration;

  function getGroupKey(label) {
    const normalized = label.toLowerCase().trim();
    const match = normalized.match(/^autolabel_(\d+)/);
    return match ? `autolabel_${match[1]}` : normalized;
  }

  function isBaseVersion(label) {
    return /^autolabel_\d+[a-z]?$/.test(label.toLowerCase().trim());
  }

  function getSubKey(label) {
    const match = label.toLowerCase().trim().match(/^autolabel_\d+([a-z])?$/);
    return match ? (match[1] || '') : '';
  }

  /**
   * Turn an HTML snippet into plain text, decoding entities
   * and preserving literal characters.
   */
  function getTextFromHtml(html) {
    const container = document.createElement('div');
    container.innerHTML = html;
    return container.textContent || '';
  }


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

    type Group = {
      baseEntries: { label: string }[];
    };

    return Object.values(groups as Group[])
      .map(group => {
        let combinedHtml = '';
        if (group.baseEntries.length) {
          group.baseEntries.sort((a, b) => getSubKey(a.label).localeCompare(getSubKey(b.label)));
          combinedHtml = group.baseEntries.map(e => htmlMapping[e.label] || '').join('<br />');
        } else {
          const fallback = entries.find(e => e.groupKey === (group as any).groupKey);
          combinedHtml = htmlMapping[fallback.label] || '';
        }
        
        const text = getTextFromHtml(combinedHtml);
        const charCount = text.length;

        return {
          groupKey: (group as any).groupKey,
          start: (group as any).start,
          end: (group as any).end,
          duration: (group as any).end - (group as any).start,
          html: combinedHtml,
          charCount,
        };
      })
      .sort((a, b) => a.start - b.start);
  }

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

  const handleRegionClick = startMs => {
    if (videoRef.current) {
      videoRef.current.currentTime = startMs / 1000;
      videoRef.current.play();
    }
  };

  function handleTimelineClick(startMs, idx) {
    handleRegionClick(startMs);
    const el = document.getElementById(`suggestion-${idx}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Apply filters
  const filteredRegions = regions.filter(r => {
    const accepted = sessionLogEvents.some(e => e.relative >= r.start && e.relative <= r.end);
    if (filterAccepted && !accepted) return false;
    const ia = iaReportMapping[r.groupKey] || { dwellTime: 0 };
    if (filterDwellTime && ia.dwellTime <= 0) return false;
    if (durationThreshold !== '' && r.duration < Number(durationThreshold)) return false;
    if (dwellThreshold !== '' && ia.dwellTime < Number(dwellThreshold)) return false;
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
    if (sortOption === 'suggestionLength') {
      return (b.charCount || 0) - (a.charCount || 0);
    }
    return 0;
  });

  // Descriptive statistics based on the filtered list
  const stats = useMemo(() => {
    const total = filteredRegions.length;
    let acceptedCount = 0;
    const durations = [];
    const dwellTimes = [];
    const acceptedDurations = [];
    const acceptedDwellTimes = [];
    const notAcceptedDurations = [];
    const notAcceptedDwellTimes = [];

    filteredRegions.forEach(r => {
      const ia = iaReportMapping[r.groupKey] || { dwellTime: 0 };
      const accepted = sessionLogEvents.some(e => e.relative >= r.start && e.relative <= r.end);
      if (accepted) {
        acceptedDurations.push(r.duration);
        acceptedDwellTimes.push(ia.dwellTime);
      } else {
        notAcceptedDurations.push(r.duration);
        notAcceptedDwellTimes.push(ia.dwellTime);
      }
      if (accepted) acceptedCount++;
      durations.push(r.duration);
      dwellTimes.push(ia.dwellTime);
    });

    const notAcceptedCount = total - acceptedCount;
    const pct = count => total > 0 ? (count / total * 100) : 0;

    const summarize = arr => {
      if (arr.length === 0) return { avg: 0, min: 0, max: 0 };
      const sum = arr.reduce((a, b) => a + b, 0);
      return {
        avg: sum / arr.length,
        min: Math.min(...arr),
        max: Math.max(...arr),
      };
    };

    // helper for just average
    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    return {
      total,
      acceptedCount,
      acceptedPct: pct(acceptedCount),
      notAcceptedCount,
      notAcceptedPct: pct(notAcceptedCount),
      duration: summarize(durations),
      dwell: summarize(dwellTimes),
      avgDurationAccepted: avg(acceptedDurations),
      avgDwellAccepted:      avg(acceptedDwellTimes),
      avgDurationNotAccepted: avg(notAcceptedDurations),
      avgDwellNotAccepted:   avg(notAcceptedDwellTimes),
    };
  }, [filteredRegions, iaReportMapping, sessionLogEvents]);

  return (
    <div className="container mx-auto p-4">
      <h1 className="mb-8 text-2xl font-semibold tracking-tighter">
        AUTOEYE Individual Report:{' '}
        <span className="bg-gray-100 p-2 pb-1 pt-1">P{participantId}</span>
      </h1>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={filterAccepted} onChange={e => setFilterAccepted(e.target.checked)} />
          Accepted
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={filterDwellTime} onChange={e => setFilterDwellTime(e.target.checked)} />
          Dwelltime &gt; 0
        </label>
        <label className="flex items-center gap-2">
          Min Duration (ms):
          <input
            type="number"
            value={durationThreshold}
            onChange={e => setDurationThreshold(e.target.value)}
            placeholder="e.g. 500"
            className="ml-2 w-24 border rounded p-1 text-sm"
          />
        </label>
        <label className="flex items-center gap-2">
          Min Dwelltime (ms):
          <input
            type="number"
            value={dwellThreshold}
            onChange={e => setDwellThreshold(e.target.value)}
            placeholder="e.g. 200"
            className="ml-2 w-24 border rounded p-1 text-sm"
          />
        </label>
        <label className="flex items-center gap-2">
          Sort by:
          <select value={sortOption} onChange={e => setSortOption(e.target.value)} className="ml-2 border rounded p-1 text-sm">
            <option value="time">Time (ascending)</option>
            <option value="duration">Duration (longest first)</option>
            <option value="dwelltime">Dwelltime (longest first)</option>
            <option value="suggestionLength">Suggestion Length (longest first)</option>
          </select>
        </label>
      </div>

      {/* Descriptive Statistics */}
      <div className="mb-6 p-4 bg-gray-50 border rounded">
        <h2 className="text-lg font-medium mb-2">Descriptive Statistics</h2>
        <ul className="list-none m-0 p-0 flex flex-wrap gap-6 text-sm">
          <li><strong>Total Suggestions:</strong> {stats.total}</li>
          <li><strong>Accepted:</strong> {stats.acceptedCount} ({stats.acceptedPct.toFixed(1)}%)</li>
          <li><strong>Not Accepted:</strong> {stats.notAcceptedCount} ({stats.notAcceptedPct.toFixed(1)}%)</li>
          <li>
            <strong>Suggestion Duration (ms):</strong> avg {stats.duration.avg.toFixed(1)}, 
            min {stats.duration.min}, max {stats.duration.max}
          </li>
          <li>
            <strong>Dwelltime (ms):</strong> avg {stats.dwell.avg.toFixed(1)}, 
            min {stats.dwell.min}, max {stats.dwell.max}
          </li>
        <li><strong>Avg Duration (Accepted):</strong> {stats.avgDurationAccepted.toFixed(1)}ms</li>
        <li><strong>Avg Dwelltime (Accepted):</strong> {stats.avgDwellAccepted.toFixed(1)}ms</li>
        <li><strong>Avg Duration (Not Accepted):</strong> {stats.avgDurationNotAccepted.toFixed(1)}ms</li>
        <li><strong>Avg Dwelltime (Not Accepted):</strong> {stats.avgDwellNotAccepted.toFixed(1)}ms</li>
        </ul>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : (
        <div className="flex flex-col md:flex-row gap-4">
          <div className="w-full md:w-1/2">
            <video
              ref={videoRef}
              controls
              className="w-full h-auto border"
              src={`/${participantId}/Videos/screenrecording.mp4`}
            >
              Your browser does not support the video tag.
            </video>
            {timelineDuration > 0 && (
              <div className="mt-4">
                <div className="relative h-12 bg-gray-200 rounded">
                  {sortedRegions.map((region, idx) => {
                    const accepted = sessionLogEvents.some(e => e.relative >= region.start && e.relative <= region.end);
                    const left = (region.start / timelineDuration) * 100;
                    const width = (region.duration / timelineDuration) * 100;
                    return (
                      <div key={idx} id={`timeline-${idx}`} className={`${accepted ? 'bg-green-600' : 'bg-red-600'} absolute h-full rounded cursor-pointer`} style={{ left: `${left}%`, width: `${width}%` }} onClick={() => handleTimelineClick(region.start, idx)} title={`${region.groupKey} (${region.duration}ms)`} />
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <div className="w-full md:w-1/2 overflow-auto max-h-[80vh]">
            {sortedRegions.map((region, idx) => {
              const ia = iaReportMapping[region.groupKey] || { viewed: false, dwellTime: 0 };
              const accepted = sessionLogEvents.some(e => e.relative >= region.start && e.relative <= region.end);
              const borderColor = accepted ? 'border-green-600' : 'border-red-600';
              const bgColor = accepted ? 'bg-green-100' : 'bg-red-100';
              const viewStyle = ia.viewed ? 'bg-gray-200' : 'opacity-50';
              return (
                <div
                  key={idx}
                  id={`suggestion-${idx}`}
                  className={`mb-4 border p-4 cursor-pointer hover:opacity-80 ${borderColor} ${bgColor} ${viewStyle}`}
                  onClick={() => handleRegionClick(region.start)}
                >
                  <div className="meta mb-2 text-sm text-gray-600">
                    <strong>Label:</strong> {region.groupKey} | <strong>Start:</strong> {region.start} | <strong>End:</strong> {region.end} |{' '}
                    <strong>Duration:</strong> {region.duration}ms | <strong>Dwelltime:</strong> {ia.dwellTime}ms |{' '}
                    <strong>Chars:</strong> {region.charCount}
                    {accepted && <span className="ml-2 font-bold text-green-600">ACCEPTED</span>}
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
