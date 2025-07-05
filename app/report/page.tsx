'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { ResponsiveContainer, ComposedChart, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Label, Bar, BarChart } from 'recharts';

import Link from 'next/link';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getGroupKey(label) {
  const normalized = label.toLowerCase().trim();
  const match = normalized.match(/^autolabel_(\d+)/);
  return match ? `autolabel_${match[1]}` : normalized;
}
function isBaseVersion(label) {
  return /^autolabel_\d+[a-z]?$/.test(label.toLowerCase().trim());
}
function getSubKey(label) {
  const m = label.toLowerCase().trim().match(/^autolabel_\d+([a-z])?$/);
  return m ? (m[1] || '') : '';
}
/** 
 * Turn an HTML snippet into its plain-text equivalent.
 * Decodes entities and drops tags, but preserves literal chars.
 */
function getTextFromHtml(html) {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container.textContent || '';
}


function parseIAS(iasText, htmlMap) {
  const lines = iasText.split('\n').filter(l => l.trim());
  const data = lines[0].startsWith('#') ? lines.slice(1) : lines;
  const entries = data.map((line, i) => {
    const p = line.split('\t');
    if (p.length < 9) return null;
    const start = Math.abs(+p[0]), end = Math.abs(+p[1]);
    return { start, end, duration: end - start, label: p[8].trim(), order: i };
  }).filter(Boolean);

  const groups = {};
  entries.forEach(e => {
    const key = getGroupKey(e.label);
    if (!groups[key]) {
      groups[key] = { groupKey: key, start: e.start, end: e.end, order: e.order, baseEntries: [] };
    } else {
      groups[key].start = Math.min(groups[key].start, e.start);
      groups[key].end   = Math.max(groups[key].end, e.end);
      groups[key].order = Math.min(groups[key].order, e.order);
    }
    if (isBaseVersion(e.label)) groups[key].baseEntries.push(e);
  });

  type Group = {
    baseEntries: { label: string }[];
  };

  return Object.values(groups as Group[])
    .map(g => {
      let html = '';
      if (g.baseEntries.length) {
        g.baseEntries.sort((a,b) => getSubKey(a.label).localeCompare(getSubKey(b.label)));
        html = g.baseEntries.map(e => htmlMap[e.label] || '').join('<br/>');
      } else {
        const fall = entries.find(x => getGroupKey(x.label) === (g as any).groupKey);
        html = htmlMap[fall.label] || '';
      }

      // derive a text-only version for counting
      const text = getTextFromHtml(html);

      // console.log("")
      // console.log(html)
      // console.log("---")
      // console.log(text)
      // console.log("")

      return {
        groupKey: (g as any).groupKey,
        start: (g as any).start,
        end: (g as any).end,
        duration: (g as any).end - (g as any).start,
        html,
        charCount: text.length,
      };
    })
    .sort((a,b) => a.start - b.start);
}

/** 
 * Parse an IA report file, either TSV or CSV.
 * Splits on tabs or commas, finds the same columns.
 */
/**
 * Parse an IA report (TSV or CSV) by dynamically finding the IA_LABEL,
 * IA_FIXATION_COUNT, and IA_DWELL_TIME columns.
 *
 * Returns a map: { [groupKey]: { viewed: boolean, dwellTime: number } }
 */
function parseIAReport(text) {
  // 0) remove any UTF-16 nulls & leading BOM
  text = text.replace(/\u0000/g, '').replace(/^\uFEFF/, '');

  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return {};

  // 1) Figure out delimiter: tab or comma
  const delim = lines[0].includes('\t') ? /\t/ : /,/;

  // 2) Build header array and a lookup map
  const rawHeaders = lines[0].replace(/^\uFEFF/, '').split(delim).map(h => h.trim());
  const headers    = rawHeaders.map(h => h.toLowerCase());
  const headerMap  = Object.fromEntries(headers.map((h, i) => [h, i]));

  // 3) Find the three indices via regex
  const li = headers.findIndex(h => h === 'ia_label');
  const fi = headers.findIndex(h => /fixation[_ ]*count/.test(h));
  const di = headers.findIndex(h => /dwell[_ ]*time/.test(h));

  if (li < 0 || fi < 0) {
    console.error('parseIAReport: cannot find IA_LABEL or IA_FIXATION_COUNT in', rawHeaders);
    return {};
  }
  if (di < 0) {
    console.warn('parseIAReport: IA_DWELL_TIME not found; all dwellTime will be zero');
  }

  // 4) Walk the rows
  const map = {};
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(delim).map(s => s.trim());
    if (parts.length < headers.length) continue;

    const label   = parts[li];
    const fcRaw   = parts[fi];
    const dwellRaw= di >= 0 ? parts[di] : '0';

    // '.' or '' → 0, non-numeric → 0
    const fc    = parseFloat(fcRaw)  || 0;
    const dwell = parseFloat(dwellRaw) || 0;

    const key = getGroupKey(label);
    if (!map[key]) map[key] = { viewed: false, dwellTime: 0 };

    if (fc > 0)         map[key].viewed    = true;
    map[key].dwellTime += dwell;
  }

  return map;
}


function parseSessionLog(text) {
  const lines = text.split(/\r?\n/).filter(l=>l.trim());
  let offset = null;
  for (const l of lines) {
    const p = l.split('\t');
    if (p[3]?.includes('Screen Recording: Starting component Screen Recording')) {
      offset = +p[1];
      break;
    }
  }
  if (offset === null) return { offset: null, events: [] };
  const ev = [];
  lines.forEach(l => {
    const p  = l.split('\t');
    const ts = +p[1];
    if (ts < offset) return;
    const msg = p[3] || '';
    if (msg.includes('KeyDown [Tab] 9')) {
      ev.push({ relative: ts - offset, type: 'accepted' });
    } else if (msg.includes('KeyDown [Escape]') || msg.includes('MouseClick')) {
      ev.push({ relative: ts - offset, type: 'rejected' });
    }
  });
  return { offset, events: ev };
}

async function computeRegions(participantId) {
  const [iasRes, htmlRes, iaRes, logRes] = await Promise.all([
    fetch(`/${participantId}/output_${participantId}.ias`),
    fetch(`/${participantId}/html_${participantId}.json`),
    fetch(`/${participantId}/IA_Report_${participantId}.txt`),
    fetch(`/${participantId}/SessionLog_${participantId}.log`),
  ]);
  if (!iasRes.ok || !htmlRes.ok || !iaRes.ok || !logRes.ok) {
    throw new Error('One or more files failed to load');
  }
  const [iasText, htmlMap, iaText, logText] = await Promise.all([
    iasRes.text(), htmlRes.json(), iaRes.text(), logRes.text()
  ]);

  const regions = parseIAS(iasText, htmlMap);
  const iaMap   = parseIAReport(iaText);
  const { events } = parseSessionLog(logText);
  const acceptedEvents = events.filter(e => e.type === 'accepted');
  const rejectedEvents = events.filter(e => e.type === 'rejected');

  return regions.map(r => {
    const accepted = acceptedEvents.some(e => e.relative >= r.start && e.relative <= r.end);
    // only reject if there was a reject‐event AND no accept‐event
    const hasReject = rejectedEvents.some(e => e.relative >= r.start && e.relative <= r.end);
    const rejected = hasReject && !accepted;
    return {
      start:     r.start,
      duration:  r.duration,
      accepted,
      rejected,
      dwellTime: iaMap[r.groupKey]?.dwellTime || 0,
      charCount: r.charCount,
    };
  });
}

// ── Index Component ─────────────────────────────────────────────────────────

export default function ReportIndex() {
  // prof 160601,160602,160603,160604,160605,170601,170602,170603,240601,240602,240603,240604
  const allParticipants = [
    '040301','040302','050302','050303','050304','060301','070301',
    '100301','100302','110301','120301','120302','130301','130302','140302',
    '190301','200301','200302','210201','210301','210302', '160601','160602',
    '160603','160604','160605','170601','170602','170603','240601','240602',
    '240603','240604'
  ];

  //── Exclude-by-ID state & derived participants ────────────────────────────
  const [excludeInput, setExcludeInput] = useState('');
  const excludeList = useMemo(
    () => excludeInput.split(',').map(s => s.trim()).filter(Boolean),
    [excludeInput]
  );
  // now `participants` is always filtered for exclusions
  const participants = useMemo(
    () => allParticipants.filter(id => !excludeList.includes(id)),
    [allParticipants, excludeList]
  );


  const [allRegionsByPart, setAllRegionsByPart] = useState({});
  const [errorsByPart, setErrorsByPart]       = useState({});
  const [loading, setLoading]                 = useState(true);

  const [filterAccepted, setFilterAccepted]   = useState(false);
  const [filterRejected, setFilterRejected]   = useState(false);
  const [filterDwellTime, setFilterDwellTime] = useState(false);
  const [durationThreshold, setDurationThreshold] = useState(''); // mininum threshold in ms
  const [dwellThreshold, setDwellThreshold]       = useState(''); // minimum threshold in ms
  const [maxDurationThreshold, setMaxDurationThreshold] = useState('');
  const [maxDwellThreshold, setMaxDwellThreshold] = useState('');
  const [bucketSize, setBucketSize] = useState(600);  // bucket size in s

  const [filterCompletedOnly, setFilterCompletedOnly] = useState(false);
  const [finishTimes, setFinishTimes]         = useState({}); // { [participantId]: number|null }
  const [showAdvanced, setShowAdvanced] = useState(false);

  // load the CSV once on mount
  useEffect(() => {
    fetch('/autoeye_participant_task1_finish_times.csv')
      .then(res => res.text())
      .then(text => {
        const lines = text.split('\n').filter(l => l.trim());
        const map = {};
        lines.slice(1).forEach(line => {
          const [pid, ms] = line.split(',');
          const id = pid.replace(/^P/, '');                   // drop leading “P”
          map[id] = ms.trim() === '#VALUE!' ? null
                                        : parseInt(ms, 10);
        });
        setFinishTimes(map);
      })
      .catch(err => console.error('Failed to load finish times', err));
  }, []);

  useEffect(() => {
    let alive = true;
    async function fetchAll() {
      const results = await Promise.all(participants.map(id =>
        computeRegions(id)
          .then(regs => ({ id, regs }))
          .catch(err => ({ id, error: err.message || 'loading failed' }))
      ));
      if (!alive) return;

      const regionsObj = {};
      const errorsObj  = {};
      results.forEach(r => {
        if ((r as any).error) errorsObj[r.id] = (r as any).error;
        else         regionsObj[r.id] = (r as any).regs;
      });

      setAllRegionsByPart(regionsObj);
      setErrorsByPart(errorsObj);
      setLoading(false);
    }
    fetchAll();
    return () => { alive = false; };
  }, [excludeList]);

  const regionsByPart = useMemo(() => {
    if (!filterCompletedOnly) return allRegionsByPart;
    const result = {};
    participants.forEach(id => {
      const finish = finishTimes[id];
      if (finish == null) return;           // skip any with #VALUE!
      const regs = allRegionsByPart[id] || [];
      // only keep regions that end ≤ finish
      result[id] = regs.filter(r => r.start + r.duration <= finish);
    });
    return result;
  }, [allRegionsByPart, finishTimes, filterCompletedOnly]);


  // ─── Compute per-participant stats + fullMaxEnd ──────────────────────────
  const statsList = useMemo(() => {
    const summarize = arr => {
      if (!arr.length) return { avg:0, min:0, max:0 };
      const sum = arr.reduce((a,b)=>a+b,0);
      return { avg: sum/arr.length, min: Math.min(...arr), max: Math.max(...arr) };
    };

    return participants.map(id => {
      // 1) if “completed‐only” and no valid finish → drop entire participant
      if (filterCompletedOnly && finishTimes[id] == null) {
        return { participantId: id, error: 'No valid Task 1 finish time' };
      }
      // 2) existing fetch‐error check
      if (errorsByPart[id]) {
        return { participantId: id, error: errorsByPart[id] };
      }

      // use the pre‐filtered regions
      const regs = regionsByPart[id] || [];

      // if “completed‐only”, fix the timeline length to finishTime
      const fullMaxEnd = filterCompletedOnly
        ? finishTimes[id]
        : regs.length
          ? Math.max(...regs.map(r => r.start + r.duration))
          : 0;

      // now your existing filters (accepted, dwell, thresholds)…
      const filtered = regs.filter(r => {
        if (filterAccepted   && !r.accepted) return false;
        if (filterRejected   && !r.rejected) return false;
        if (filterDwellTime  && r.dwellTime <= 0) return false;
        if (durationThreshold !== '' && r.duration < +durationThreshold) return false;
        if (dwellThreshold     !== '' && r.dwellTime < +dwellThreshold)   return false;
        if (maxDurationThreshold !== '' && r.duration > +maxDurationThreshold) return false;
        if (maxDwellThreshold !== ''     && r.dwellTime > +maxDwellThreshold)   return false;
        return true;
      });

      const total = filtered.length;
      const acceptedCount = filtered.filter(r => r.accepted).length;
      const notAcceptedCount = total - acceptedCount;
      const rejectedCount = filtered.filter(r => r.rejected).length;
      const pct = x => total>0 ? (x/total*100) : 0;

      return {
        participantId: id,
        fullMaxEnd,
        filteredRegions: filtered,
        total,
        acceptedCount,
        acceptedPct: pct(acceptedCount),
        notAcceptedCount,
        rejectedCount,
        rejectedPct: pct(rejectedCount),
        notAcceptedPct: pct(notAcceptedCount),
        durationSummary: summarize(filtered.map(r=>r.duration)),
        dwellSummary:   summarize(filtered.map(r=>r.dwellTime)),
      };
    });
  }, [
    participants, regionsByPart, errorsByPart,
    finishTimes, filterCompletedOnly, errorsByPart,
    filterAccepted, filterRejected, filterDwellTime,
    durationThreshold, dwellThreshold, 
    maxDurationThreshold, maxDwellThreshold
  ]);

  // ── Compute Overall Summary with SE ─────────────────────────────────────
  const overall = useMemo(() => {
    const summarize = arr => {
      const n = arr.length;
      if (n === 0) return { avg: 0, se: 0, min: 0, max: 0 };
      const sum = arr.reduce((a,b) => a + b, 0);
      const avg = sum / n;
      const min = Math.min(...arr);
      const max = Math.max(...arr);
      const se = n > 1
        ? Math.sqrt(arr.reduce((s,x) => s + Math.pow(x - avg, 2), 0) / (n - 1)) / Math.sqrt(n)
        : 0;
      return { avg, se, min, max };
    };

    // flatten & filter regions as before
    const allRegs = Object.values(regionsByPart).flat();
    const filtered = allRegs.filter(r => {
      if (filterAccepted   && !(r as any).accepted) return false;
      if (filterRejected   && !(r as any).rejected) return false;
      if (filterDwellTime  && (r as any).dwellTime <= 0) return false;
      if (durationThreshold && (r as any).duration < +durationThreshold) return false;
      if (dwellThreshold    && (r as any).dwellTime < +dwellThreshold) return false;
      if (maxDurationThreshold !== '' && (r as any).duration > +maxDurationThreshold) return false;
      if (maxDwellThreshold !== ''     && (r as any).dwellTime > +maxDwellThreshold)   return false;
      return true;
    });

    const total = filtered.length;
    const acceptedCount = filtered.filter(r => (r as any).accepted).length;
    const notAcceptedCount = total - acceptedCount;
    const rejectedCount = filtered.filter(r => (r as any).rejected).length;
    const pct = x => total > 0 ? (x / total * 100) : 0;

    // summary for duration & dwell
    const durationSummary = summarize(filtered.map(r => (r as any).duration));
    const dwellSummary   = summarize(filtered.map(r => (r as any).dwellTime));

    // wasted dwell per participant
    const wastedList = participants.map(id => {
      const regs = regionsByPart[id] || [];
      const regsFilt = regs.filter(r => {
        if (filterAccepted   && !r.accepted) return false;
        if (filterRejected   && !(r as any).rejected) return false;
        if (filterDwellTime  && r.dwellTime <= 0) return false;
        if (durationThreshold && r.duration < +durationThreshold) return false;
        if (dwellThreshold    && r.dwellTime < +dwellThreshold) return false;
        if (maxDurationThreshold !== '' && (r as any).duration > +maxDurationThreshold) return false;
        if (maxDwellThreshold !== ''     && (r as any).dwellTime > +maxDwellThreshold)   return false;
        return true;
      });
      return regsFilt
        .filter(r => !r.accepted)
        .reduce((s, r) => s + r.dwellTime, 0);
    });
    const np = wastedList.length;
    const avgWasted = np > 0 ? wastedList.reduce((a,b) => a + b, 0) / np : 0;
    const seWasted = np > 1
      ? Math.sqrt(wastedList.reduce((s,x) => s + Math.pow(x - avgWasted, 2), 0) / (np - 1)) / Math.sqrt(np)
      : 0;

    // accepted dwell per participant
    const acceptedList = participants.map(id => {
      const regs = regionsByPart[id] || [];
      const regsFilt = regs.filter(r => {
        if (filterAccepted   && !r.accepted) return false;
        if (filterRejected   && !(r as any).rejected) return false;
        if (filterDwellTime  && r.dwellTime <= 0) return false;
        if (durationThreshold && r.duration < +durationThreshold) return false;
        if (dwellThreshold    && r.dwellTime < +dwellThreshold) return false;
        if (maxDurationThreshold !== '' && (r as any).duration > +maxDurationThreshold) return false;
        if (maxDwellThreshold !== ''     && (r as any).dwellTime > +maxDwellThreshold)   return false;
        return true;
      });
      return regsFilt
        .filter(r => r.accepted)
        .reduce((s, r) => s + r.dwellTime, 0);
    });
    const ap = acceptedList.length;
    const avgAcceptedDwell = ap > 0 ? acceptedList.reduce((a,b) => a + b, 0) / ap : 0;
    const seAcceptedDwell = ap > 1
      ? Math.sqrt(acceptedList.reduce((s,x) => s + Math.pow(x - avgAcceptedDwell, 2), 0) / (ap - 1)) / Math.sqrt(ap)
      : 0;

    return {
      total,
      acceptedCount,
      acceptedPct: pct(acceptedCount),
      notAcceptedCount,
      notAcceptedPct: pct(notAcceptedCount),
      rejectedCount,
      rejectedPct: pct(rejectedCount),
      durationSummary,
      dwellSummary,
      avgWasted,
      seWasted,
      avgAcceptedDwell,
      seAcceptedDwell
    };

  }, [participants, regionsByPart, filterAccepted, filterRejected, filterDwellTime, durationThreshold, dwellThreshold, maxDurationThreshold, maxDwellThreshold]);

  // ── Compute data for duration-threshold vs. suggestion-ratio plot ───────────
  const suggestionRatioData = useMemo(() => {
    // flatten all regions into one array
    const regs = Object.values(regionsByPart).flat();
    const originalTotal = regs.length;
    // build an array [{ duration: 0, ratio: 1 }, { duration: 10, ratio: 0.98 }, …, {duration:1000, ratio:0}]
    return Array.from({ length: 101 }, (_, i) => {
      const duration = i * 10;
      const count = regs.filter(r => (r as any).duration >= duration).length;
      return {
        duration,
        ratio: originalTotal > 0 ? count / originalTotal : 0
      };
    });
  }, [allRegionsByPart, regionsByPart]);

  // ── Compute data for dwelltime-threshold vs. suggestion-ratio plot ────────
  const dwellRatioData = useMemo(() => {
    const regs = Object.values(regionsByPart).flat();
    const originalTotal = regs.length;
    return Array.from({ length: 1001 }, (_, i) => {
      const dwell = i * 1;
      const count = regs.filter(r => (r as any).dwellTime >= dwell).length;
      return {
        dwell,
        ratio: originalTotal > 0 ? count / originalTotal : 0
      };
    });
  }, [allRegionsByPart, regionsByPart]);

  // ── Compute data for bucket-size vs. suggestion-ratio plot ────────────────
  const bucketAcceptanceData = useMemo(() => {
    const regs = Object.values(regionsByPart).flat().filter(r => {
      if (filterAccepted   && !(r as any).accepted)     return false;
      if (filterRejected   && !(r as any).rejected) return false;
      if (filterDwellTime  && (r as any).dwellTime <= 0) return false;
      if (durationThreshold !== '' && (r as any).duration < +durationThreshold) return false;
      if (dwellThreshold     !== '' && (r as any).dwellTime < +dwellThreshold)   return false;
      if (maxDurationThreshold !== '' && (r as any).duration > +maxDurationThreshold) return false;
      if (maxDwellThreshold !== '' && (r as any).dwellTime > +maxDwellThreshold)   return false;
      return true;
    });

    const bucketMs = bucketSize * 1000;
    const maxTime = regs.length
      ? Math.max(...regs.map(r => (r as any).start + (r as any).duration))
      : 0;
    const buckets = Math.ceil(maxTime / bucketMs);

    return Array.from({ length: buckets }, (_, i) => {
      const startMs = i * bucketMs;
      const endMs   = startMs + bucketMs;
      const slice = regs.filter(r => (r as any).start >= startMs && (r as any).start < endMs);
      const tot   = slice.length;
      const acc   = slice.filter(r => (r as any).accepted).length;
      return {
        start: +(i * bucketSize).toFixed(2),    // seconds
        rate:  tot > 0 ? acc / tot : null,
        count: tot,
      };
    });
  }, [
    participants, regionsByPart, errorsByPart,
    finishTimes, filterCompletedOnly,
    filterAccepted, filterRejected, filterDwellTime,
    durationThreshold, dwellThreshold,
    maxDurationThreshold, maxDwellThreshold,
    bucketSize
  ]);

  // ── Acceptance Rate Over Relative Timeline ───────────────────────────────
const relativeAcceptanceData = useMemo(() => {
  // flatten all participants’ regions with a relative timestamp
  const all = participants.flatMap(id => {
    // skip participants without data or without a timeline
    const regs = (regionsByPart[id] || []).filter(r => {
      if (filterAccepted   && !r.accepted) return false;
      if (filterRejected   && !(r as any).rejected) return false;
      if (filterDwellTime  && r.dwellTime <= 0) return false;
      if (durationThreshold !== '' && r.duration < +durationThreshold) return false;
      if (dwellThreshold     !== '' && r.dwellTime < +dwellThreshold)   return false;
      if (maxDurationThreshold !== '' && (r as any).duration > +maxDurationThreshold) return false;
      if (maxDwellThreshold !== '' && (r as any).dwellTime > +maxDwellThreshold) return false;
      return true;
    });
    // determine full length for this participant
    const full = filterCompletedOnly
      ? finishTimes[id] ?? 0
      : regs.length
        ? Math.max(...regs.map(r => r.start + r.duration))
        : 0;
    if (full <= 0) return [];
    return regs.map(r => ({
      relative: r.start / full,
      accepted: r.accepted
    }));
  });

  const bucketCount = 10; // e.g. 25% bins
    return Array.from({ length: bucketCount }, (_, i) => {
      const low = i / bucketCount;
      const high = (i + 1) / bucketCount;
      const slice = all.filter(x => x.relative >= low && x.relative < high);
      const tot   = slice.length;
      const acc   = slice.filter(x => x.accepted).length;
      return {
        lowPct:  +(low  * 100).toFixed(0),    // e.g.  0,  5, …
        highPct: +((high * 100).toFixed(0)),  // e.g.  5, 10, …
        rate:    tot > 0 ? acc / tot : null,
        count:   tot
      };
    });
  }, [
    participants, regionsByPart, finishTimes,
    filterCompletedOnly,
    filterAccepted, filterRejected, filterDwellTime,
    durationThreshold, dwellThreshold,
    maxDurationThreshold, maxDwellThreshold
  ]);

  
  // ── Compute cumulative suggestion‐length vs acceptance ratio ─────────────────
  const suggestionLengthData = useMemo(() => {
    const regs = Object.values(regionsByPart)
    .flat()
    .filter(r => {
      if (filterAccepted   && !(r as any).accepted)       return false;
      if (filterRejected   && !(r as any).rejected) return false;
      if (filterDwellTime  && (r as any).dwellTime <=   0) return false;
      if (durationThreshold !== '' && (r as any).duration < +durationThreshold) return false;
      if (dwellThreshold     !== '' && (r as any).dwellTime < +dwellThreshold)     return false;
      if (maxDurationThreshold !== '' && (r as any).duration > +maxDurationThreshold) return false;
      if (maxDwellThreshold !== '' && (r as any).dwellTime > +maxDwellThreshold) return false;
      return true;
    });

    if (!regs.length) return [];

    // determine overall max and split into 50 bins
    const maxChar  = Math.max(...regs.map(r => (r as any).charCount));
    const binCount = 50;
    const binSize  = Math.ceil(maxChar / binCount);

    return Array.from({ length: binCount + 1 }, (_, i) => {
      const threshold = i * binSize;
      const slice     = regs.filter(r => (r as any).charCount >= threshold);
      const total     = slice.length;
      const acc       = slice.filter(r => (r as any).accepted).length;
      return {
        threshold,
        count: total,
        acceptanceRatio: total > 0 ? acc / total : null,
        binSize           // include for caption/tokenization if you like
      };
    });
  }, [
    participants, regionsByPart, errorsByPart,
    finishTimes, filterCompletedOnly,
    filterAccepted,
    filterRejected,
    filterDwellTime,
    durationThreshold,
    dwellThreshold,
    maxDurationThreshold,
    maxDwellThreshold
  ]);

  // ── Compute histogram of suggestion lengths ──────────────────────────────
  const suggestionLengthHistogram = useMemo(() => {
    const regs = Object.values(regionsByPart)
    .flat()
    .filter(r => {
      if (filterAccepted   && !(r as any).accepted)       return false;
      if (filterRejected   && !(r as any).rejected) return false;
      if (filterDwellTime  && (r as any).dwellTime <=   0) return false;
      if (durationThreshold !== '' && (r as any).duration < +durationThreshold) return false;
      if (dwellThreshold     !== '' && (r as any).dwellTime < +dwellThreshold)     return false;
      if (maxDurationThreshold !== '' && (r as any).duration > +maxDurationThreshold) return false;
      if (maxDwellThreshold !== '' && (r as any).dwellTime > +maxDwellThreshold) return false;
      return true;
    });

    if (!regs.length) return [];
    const maxChar  = Math.max(...regs.map(r => (r as any).charCount));
    const binCount = 50;
    const binSize  = Math.ceil(maxChar / binCount);

    return Array.from({ length: binCount }, (_, i) => {
      const binStart = i * binSize;
      const binEnd   = binStart + binSize;
      const count    = regs.filter(
        r => (r as any).charCount >= binStart && (r as any).charCount < binEnd
      ).length;
      return { binStart, binEnd, count };
    });
  }, [
    participants, regionsByPart, errorsByPart,
    finishTimes, filterCompletedOnly,
    filterAccepted,
    filterRejected,
    filterDwellTime,
    durationThreshold,
    dwellThreshold,
    maxDurationThreshold,
    maxDwellThreshold
  ]);

  // ── Compute cumulative avg dwell‐time by suggestion length ─────────────────
  const suggestionLengthDwellData = useMemo(() => {
    const regs = Object.values(regionsByPart)
    .flat()
    .filter(r => {
      if (filterAccepted   && !(r as any).accepted)       return false;
      if (filterRejected   && !(r as any).rejected) return false;
      if (filterDwellTime  && (r as any).dwellTime <=   0) return false;
      if (durationThreshold !== '' && (r as any).duration < +durationThreshold) return false;
      if (dwellThreshold     !== '' && (r as any).dwellTime < +dwellThreshold)     return false;
      if (maxDurationThreshold !== '' && (r as any).duration > +maxDurationThreshold) return false;
      if (maxDwellThreshold !== '' && (r as any).dwellTime > +maxDwellThreshold) return false;
      return true;
    });

    if (!regs.length) return [];

    // same binning as length thresholds
    const maxChar  = Math.max(...regs.map(r => (r as any).charCount));
    const binCount = 50;
    const binSize  = Math.ceil(maxChar / binCount);

    return Array.from({ length: binCount + 1 }, (_, i) => {
      const threshold = i * binSize;
      const slice     = regs.filter(r => (r as any).charCount >= threshold);
      const count     = slice.length;
      const sumDwell  = slice.reduce((sum, r) => sum + (r as any).dwellTime, 0);
      const avgDwell  = count > 0 ? (sumDwell as any) / count : null;

      return { threshold, count, avgDwell };
    });
  }, [
    participants, regionsByPart, errorsByPart,
    finishTimes, filterCompletedOnly,
    filterAccepted,
    filterRejected,
    filterDwellTime,
    durationThreshold,
    dwellThreshold,
    maxDurationThreshold,
    maxDwellThreshold
  ]);


  // ── Compute cumulative avg normalized dwell‐time over task timeline ────────
  const bucketNormalizedDwellData = useMemo(() => {
    // flatten + apply the same filters you use for acceptance
    const regs = Object.values(regionsByPart).flat().filter(r => {
      if (filterAccepted   && !(r as any).accepted)       return false;
      if (filterRejected   && !(r as any).rejected) return false;
      if (filterDwellTime  && (r as any).dwellTime <= 0)   return false;
      if (durationThreshold !== '' && (r as any).duration < +durationThreshold) return false;
      if (dwellThreshold     !== '' && (r as any).dwellTime < +dwellThreshold)   return false;
      if (maxDurationThreshold !== '' && (r as any).duration > +maxDurationThreshold) return false;
      if (maxDwellThreshold !== '' && (r as any).dwellTime > +maxDwellThreshold) return false;
      return true;
    });

    const bucketMs = bucketSize * 1000;
    const maxTime  = regs.length
      ? Math.max(...regs.map(r => (r as any).start + (r as any).duration))
      : 0;
    const buckets  = Math.ceil(maxTime / bucketMs);

    return Array.from({ length: buckets }, (_, i) => {
      const startMs = i * bucketMs;
      const slice   = regs.filter(r => (r as any).start >= startMs && (r as any).start < startMs + bucketMs);
      const count   = slice.length;
      // normalized dwell time in seconds per char
      const sumNorm = slice.reduce(
        (sum, r) => (sum as any) + ((r as any).dwellTime / 1000) / (r as any).charCount,
        0
      );
      const avgNorm = count > 0 ? (sumNorm as any) / count : null;

      return {
        start: +(i * bucketSize).toFixed(2),  // seconds
        avgNorm,
      };
    });
  }, [
    participants, regionsByPart, errorsByPart,
    finishTimes, filterCompletedOnly,
    filterAccepted, filterRejected, filterDwellTime,
    durationThreshold, dwellThreshold,
    maxDurationThreshold, maxDwellThreshold,
    bucketSize
  ]);

  // ── Compute cumulative avg normalized dwell (ms per char) by suggestion length ──────
  const suggestionLengthNormDwellData = useMemo(() => {
    const regs = Object.values(regionsByPart)
    .flat()
    .filter(r => {
      if (filterAccepted   && !(r as any).accepted)       return false;
      if (filterRejected   && !(r as any).rejected) return false;
      if (filterDwellTime  && (r as any).dwellTime <=   0) return false;
      if (durationThreshold !== '' && (r as any).duration < +durationThreshold) return false;
      if (dwellThreshold     !== '' && (r as any).dwellTime < +dwellThreshold)     return false;
      if (maxDurationThreshold !== '' && (r as any).duration > +maxDurationThreshold) return false;
      if (maxDwellThreshold !== '' && (r as any).dwellTime > +maxDwellThreshold) return false;
      return true;
    });

    if (!regs.length) return [];

    const maxChar  = Math.max(...regs.map(r => (r as any).charCount));
    const binCount = 50;
    const binSize  = Math.ceil(maxChar / binCount);

    return Array.from({ length: binCount + 1 }, (_, i) => {
      const threshold = i * binSize;
      const slice     = regs.filter(r => (r as any).charCount >= threshold);
      const count     = slice.length;
      const sumNorm   = slice.reduce((sum, r) => (sum as any) + ((r as any).dwellTime / (r as any).charCount), 0);
      const avgNorm   = count > 0 ? (sumNorm as any) / count : null;

      return { threshold, count, avgNorm, binSize };
    });
  }, [
    participants, regionsByPart, errorsByPart,
  finishTimes, filterCompletedOnly,
    filterAccepted,
    filterRejected,
    filterDwellTime,
    durationThreshold,
    dwellThreshold,
    maxDurationThreshold,
    maxDwellThreshold
  ]);


  // ── Average wasted dwell per participant ────────────────────────────────
  const avgWastedPerParticipant = useMemo(() => {
    // for each participant, sum dwellTime for non‐accepted suggestions, then average
    const totalWasted = participants.reduce((sum, id) => {
      const regs = regionsByPart[id] || [];
      const filtered = regs.filter(r => {
        if (filterAccepted   && !r.accepted)       return false;
        if (filterRejected   && !(r as any).rejected) return false;
        if (filterDwellTime  && r.dwellTime <= 0)   return false;
        if (durationThreshold !== '' && r.duration < +durationThreshold) return false;
        if (dwellThreshold     !== '' && r.dwellTime < +dwellThreshold)   return false;
        if (maxDurationThreshold !== '' && (r as any).duration > +maxDurationThreshold) return false;
        if (maxDwellThreshold !== '' && (r as any).dwellTime > +maxDwellThreshold) return false;
        return true;
      });
      const wasted = filtered
        .filter(r => !r.accepted)
        .reduce((s, r) => s + r.dwellTime, 0);
      return sum + wasted;
    }, 0);

    return participants.length > 0
      ? totalWasted / participants.length
      : 0;
  }, [
    participants, regionsByPart, errorsByPart,
    finishTimes, filterCompletedOnly,
    filterAccepted, filterRejected, filterDwellTime,
    durationThreshold, dwellThreshold,
    maxDurationThreshold, maxDwellThreshold
  ]);


  // ── Average dwell on accepted suggestions per participant ────────────────
  const avgAcceptedDwellPerParticipant = useMemo(() => {
    // for each participant, sum dwellTime for accepted suggestions, then average
    const totalAcceptedDwell = participants.reduce((sum, id) => {
      const regs = regionsByPart[id] || [];
      const filtered = regs.filter(r => {
        if (filterAccepted   && !r.accepted)       return false;
        if (filterRejected   && !(r as any).rejected) return false;
        if (filterDwellTime  && r.dwellTime <= 0)   return false;
        if (durationThreshold !== '' && r.duration < +durationThreshold) return false;
        if (dwellThreshold     !== '' && r.dwellTime < +dwellThreshold)   return false;
        if (maxDurationThreshold !== '' && (r as any).duration > +maxDurationThreshold) return false;
        if (maxDwellThreshold !== '' && (r as any).dwellTime > +maxDwellThreshold) return false;
        return true;
      });
      const acceptedDwell = filtered
        .filter(r => r.accepted)
        .reduce((s, r) => s + r.dwellTime, 0);
      return sum + acceptedDwell;
    }, 0);

    return participants.length > 0
      ? totalAcceptedDwell / participants.length
      : 0;
  }, [
    participants, regionsByPart, errorsByPart,
    finishTimes, filterCompletedOnly,
    filterAccepted, filterRejected, filterDwellTime,
    durationThreshold, dwellThreshold,
    maxDurationThreshold, maxDwellThreshold
  ]);


  // ── QA expansion state ───────────────────────────────
  const [showQuestions, setShowQuestions] = useState(false);

  // ── Questions & computed answers ─────────────────────

  const qaList = useMemo(() => {
    // flatten + apply same filters as “overall”
    const allRegs = Object.values(regionsByPart)
      .flat()
      .filter(r => {
        if (filterAccepted   && !(r as any).accepted)                           return false;
        if (filterRejected   && !(r as any).rejected) return false;
        if (filterDwellTime  && (r as any).dwellTime <= 0)                       return false;
        if (durationThreshold !== '' && (r as any).duration < +durationThreshold) return false;
        if (dwellThreshold     !== '' && (r as any).dwellTime < +dwellThreshold)   return false;
        if (maxDurationThreshold !== '' && (r as any).duration > +maxDurationThreshold) return false;
        if (maxDwellThreshold !== '' && (r as any).dwellTime > +maxDwellThreshold) return false;
        return true;
      });

    // split into accepted vs rejected
    const accRegs = allRegs.filter(r => (r as any).accepted);
    const rejRegs = allRegs.filter(r => !(r as any).accepted);

    // compute average char-length
    const avgLen = regs =>
      regs.length
        ? regs.reduce((sum, r) => sum + r.charCount, 0) / regs.length
        : 0;

    const avgLenAccepted = avgLen(accRegs);
    const avgLenRejected = avgLen(rejRegs);

    // compute standard error for char-length
    const seLen = regs => {
      const n = regs.length;
      if (n < 2) return 0;
      const mean = regs.reduce((s, r) => s + r.charCount, 0) / n;
      const variance = regs.reduce((s, r) => s + Math.pow(r.charCount - mean, 2), 0) / (n - 1);
      return Math.sqrt(variance) / Math.sqrt(n);
    };

    const seLenAccepted = seLen(accRegs);
    const seLenRejected = seLen(rejRegs);

    // compute average dwell-time (in ms)
    const avgDwell = regs =>
      regs.length
        ? regs.reduce((sum, r) => sum + r.dwellTime, 0) / regs.length
        : 0;

    const avgDwellAccepted = avgDwell(accRegs);
    const avgDwellRejected = avgDwell(rejRegs);

    // compute standard error for dwell-time
    const seDwell = regs => {
      const n = regs.length;
      if (n < 2) return 0;
      const mean = regs.reduce((s, r) => s + r.dwellTime, 0) / n;
      const variance = regs.reduce((s, r) => s + Math.pow(r.dwellTime - mean, 2), 0) / (n - 1);
      return Math.sqrt(variance) / Math.sqrt(n);
    };

    const seDwellAccepted = seDwell(accRegs);
    const seDwellRejected = seDwell(rejRegs);

    // grab first/last buckets for time-series questions
    const firstNorm = bucketNormalizedDwellData[0]?.avgNorm ?? null;
    const lastNorm  = bucketNormalizedDwellData[bucketNormalizedDwellData.length - 1]?.avgNorm ?? null;
    const firstAcc  = bucketAcceptanceData[0]?.rate ?? null;
    const lastAcc   = bucketAcceptanceData[bucketAcceptanceData.length - 1]?.rate ?? null;

    // compute average suggestions per participant
    const participantCounts = participants.map(id => (regionsByPart[id] || []).filter(r => {
      if (filterAccepted   && !r.accepted)                           return false;
      if (filterRejected   && !(r as any).rejected) return false;
      if (filterDwellTime  && r.dwellTime <= 0)                       return false;
      if (durationThreshold !== '' && r.duration < +durationThreshold) return false;
      if (dwellThreshold     !== '' && r.dwellTime < +dwellThreshold)   return false;
      if (maxDurationThreshold !== '' && (r as any).duration > +maxDurationThreshold) return false;
      if (maxDwellThreshold !== '' && (r as any).dwellTime > +maxDwellThreshold) return false;
      return true;
    }).length);
    const avgSuggestions = participantCounts.length > 0
      ? participantCounts.reduce((sum, c) => sum + c, 0) / participantCounts.length
      : 0;

    return [
      {
        question: 'How much time do developers spend reviewing suggestions that are ultimately rejected?',
        answer: `${(avgWastedPerParticipant/1000).toFixed(1)}s per participant on average`
      },
      {
        question: 'What is the acceptance vs. rejection rate for autocomplete suggestions?',
        answer: `${overall.acceptedPct.toFixed(1)}% accepted, ${overall.notAcceptedPct.toFixed(1)}% rejected`
      },
      {
        question: 'Is more time spent reviewing suggestions (normalized by suggestion length) at the beginning of the task than at the end?',
        answer: firstNorm !== null && lastNorm !== null
          ? `${firstNorm.toFixed(4)} s/char at start vs ${lastNorm.toFixed(4)} s/char at end (${firstNorm > lastNorm ? 'decrease' : 'increase'} over time)`
          : 'requires additional analysis'
      },
      {
        question: 'Does the time spent reviewing suggestions (normalized by suggestion length) change over the course of the task?',
        answer: firstNorm !== null && lastNorm !== null
          ? `Yes – normalized dwell changed from ${firstNorm.toFixed(4)} to ${lastNorm.toFixed(4)} s/char`
          : 'requires additional analysis'
      },
      {
        question: 'What is the change in suggestion acceptance ratio over the task timeline?',
        answer: firstAcc !== null && lastAcc !== null
          ? `Acceptance rate went from ${(firstAcc*100).toFixed(1)}% to ${(lastAcc*100).toFixed(1)}%`
          : 'requires additional analysis'
      },
      {
        question: 'What is the average length (characters) of an accepted suggestion?',
        answer: `${avgLenAccepted.toFixed(1)} ± ${seLenAccepted.toFixed(1)} chars`
      },
      {
        question: 'What is the average length (characters) of a rejected suggestion?',
        answer: `${avgLenRejected.toFixed(1)} ± ${seLenRejected.toFixed(1)} chars`
      },
      {
        question: 'What is the average dwell time per accepted suggestion?',
        answer: `${(avgDwellAccepted/1000).toFixed(1)} ± ${(seDwellAccepted/1000).toFixed(4)}s per suggestion`
      },
      {
        question: 'What is the average dwell time per rejected suggestion?',
        answer: `${(avgDwellRejected/1000).toFixed(1)} ± ${(seDwellRejected/1000).toFixed(4)}s per suggestion`
      },
      {
        question: 'What is the average number of suggestions shown to participants?',
        answer: `${avgSuggestions.toFixed(1)} suggestions per participant on average`
      }
    ];
  }, [
    regionsByPart,
    filterAccepted,
    filterRejected,
    filterDwellTime,
    durationThreshold,
    dwellThreshold,
    maxDurationThreshold,
    maxDwellThreshold,
    bucketNormalizedDwellData,
    bucketAcceptanceData,
    avgWastedPerParticipant,
    overall.acceptedPct,
    overall.notAcceptedPct,
    participants
  ]);



  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">All Participants Summary</h1>

      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          {/* Filters */}
          <div className="sticky top-0 bg-white z-10 mb-6 p-4">
            {/* Always-visible filters, left-aligned */}
            <div className="flex flex-wrap items-center gap-4">
              <span className="font-medium">N={participants.length}</span>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={filterAccepted}
                  onChange={e => setFilterAccepted(e.target.checked)}
                />
                Accepted
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={filterDwellTime}
                  onChange={e => setFilterDwellTime(e.target.checked)}
                />
                Dwelltime {">"} 0
              </label>
              <label className="flex items-center gap-2 text-sm">
                Min Duration (ms):
                <input
                  type="number"
                  value={durationThreshold}
                  onChange={e => setDurationThreshold(e.target.value)}
                  placeholder="e.g. 500"
                  className="ml-2 w-24 border rounded p-1 text-sm"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                Min Dwelltime (ms):
                <input
                  type="number"
                  value={dwellThreshold}
                  onChange={e => setDwellThreshold(e.target.value)}
                  placeholder="e.g. 200"
                  className="ml-2 w-24 border rounded p-1 text-sm"
                />
              </label>
            </div>

            {/* Toggle advanced label in metadata style below filters */}
            <div
              className="mt-1 text-xs text-gray-500 italic cursor-pointer flex items-center"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <span
                className={`transform transition-transform duration-200 mr-1 ${showAdvanced ? 'rotate-90' : ''}`}
              >▶</span>
              <span>Toggle Advanced Filtering</span>
            </div>

            {/* Advanced filters panel */}
            {showAdvanced && (
              <div className="mt-2 flex flex-wrap items-center gap-4 text-sm border-t pt-4">
                <label
                  className="flex items-center gap-2"
                  title="Suggestions actively dismissed via ESC key or mouse click"
                >
                  <input
                    type="checkbox"
                    checked={filterRejected}
                    onChange={e => setFilterRejected(e.target.checked)}
                  />
                  Actively Rejected
                </label>
                <label className="flex items-center gap-2">
                  Completed Task 1
                  <input
                    type="checkbox"
                    checked={filterCompletedOnly}
                    onChange={e => setFilterCompletedOnly(e.target.checked)}
                  />
                </label>
                <label className="flex items-center gap-2">
                  Exclude Participants:
                  <input
                    type="text"
                    placeholder="e.g. 040301,050302"
                    value={excludeInput}
                    onChange={e => setExcludeInput(e.target.value)}
                    className="ml-2 w-48 border rounded p-1 text-sm"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  Max Duration (ms):
                  <input
                    type="number"
                    value={maxDurationThreshold}
                    onChange={e => setMaxDurationThreshold(e.target.value)}
                    placeholder="e.g. 2000"
                    className="ml-2 w-24 border rounded p-1 text-sm"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  Max Dwelltime (ms):
                  <input
                    type="number"
                    value={maxDwellThreshold}
                    onChange={e => setMaxDwellThreshold(e.target.value)}
                    placeholder="e.g. 1000"
                    className="ml-2 w-24 border rounded p-1 text-sm"
                  />
                </label>
              </div>
            )}
          </div>





          {/* ── Overall Summary as Table ───────────────────────────────── */}
          <div className="p-4 mb-4 bg-gray-50 border rounded">
            <h2 className="text-xl font-semibold mb-2">Overall (Filtered) Summary</h2>
            <table className="w-full text-sm table-auto border-collapse">
              <thead>
                <tr className="bg-gray-200">
                  <th className="border px-2 py-1 text-left">Metric</th>
                  <th className="border px-2 py-1 text-left">Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border px-2 py-1">Total Suggestions</td>
                  <td className="border px-2 py-1">{overall.total}</td>
                </tr>
                <tr>
                  <td className="border px-2 py-1">Accepted</td>
                  <td className="border px-2 py-1">
                    {overall.acceptedCount} ({overall.acceptedPct.toFixed(1)}%)
                  </td>
                </tr>
                <tr>
                  <td className="border px-2 py-1">Not Accepted</td>
                  <td className="border px-2 py-1">
                    {overall.notAcceptedCount} ({overall.notAcceptedPct.toFixed(1)}%)
                  </td>
                </tr>
                <tr>
                  <td
                    className="border px-2 py-1"
                    title="Suggestions actively dismissed via ESC key or mouse click"
                  >
                    Actively Rejected
                  </td>
                  <td className="border px-2 py-1">
                    {overall.rejectedCount} ({overall.rejectedPct.toFixed(1)}%)
                  </td>
                </tr>
                <tr>
                  <td className="border px-2 py-1">Duration per Suggestion (ms)</td>
                  <td className="border px-2 py-1">
                    avg {overall.durationSummary.avg.toFixed(1)} ± {overall.durationSummary.se.toFixed(1)},
                    min {overall.durationSummary.min}, max {overall.durationSummary.max}
                  </td>
                </tr>
                <tr>
                  <td className="border px-2 py-1">Dwell per Suggestion (ms)</td>
                  <td className="border px-2 py-1">
                    avg {overall.dwellSummary.avg.toFixed(1)} ± {overall.dwellSummary.se.toFixed(1)},
                    min {overall.dwellSummary.min}, max {overall.dwellSummary.max}
                  </td>
                </tr>
                <tr>
                  <td className="border px-2 py-1">Avg Wasted Dwell per Participant (s)</td>
                  <td className="border px-2 py-1">
                    {(overall.avgWasted/1000).toFixed(1)} ± {(overall.seWasted/1000).toFixed(1)}s
                  </td>
                </tr>
                <tr>
                  <td className="border px-2 py-1">Avg Dwell on Accepted per Participant (s)</td>
                  <td className="border px-2 py-1">
                    {(overall.avgAcceptedDwell/1000).toFixed(1)} ± {(overall.seAcceptedDwell/1000).toFixed(1)}s
                  </td>
                </tr>
              </tbody>
            </table>

            {/* ── Expandable Q&A ─────────────────────────────────── */}
            <div className="mb-4 mt-4">
              <button
                onClick={() => setShowQuestions(!showQuestions)}
                className="px-4 py-1 bg-blue-500 text-white rounded"
              >
                {showQuestions ? 'Hide' : 'Show'} Questions & Answers
              </button>
              {showQuestions && (
                <div className="mt-2 border p-4 rounded bg-gray-50">
                  {qaList.map((item, idx) => (
                    <div key={idx} className="mb-3">
                      <strong>{item.question}</strong>
                      <div className="mt-1">{item.answer}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          {/* ── Threshold vs. Remaining Suggestions (side by side) ───────────────── */}
          <div className="mt-6 flex flex-wrap gap-6">
            {/* Duration */}
            <figure className="flex-1 min-w-[300px]">
              <figcaption className="text-sm text-gray-600 mb-2">
                Percentage of all suggestions whose duration ≥ the given threshold
              </figcaption>
              <h3 className="text-lg font-medium mb-2">
                Duration Threshold vs % Remaining Suggestions
              </h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart
                  // width={500}
                  // height={200}
                  data={suggestionRatioData}
                  margin={{ top: 20, right: 20, bottom: 20, left: 80 }}  // ← extra left space
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="duration"
                    tick={{ fontSize: 12 }}
                    label={{ value: 'Duration Threshold (ms)', position: 'insideBottom', offset: -10, style: { fontSize: 12 } }}
                  />
                  <YAxis
                    domain={[0, 1]}
                    tick={{ fontSize: 12 }}
                    tickFormatter={v => `${(v * 100).toFixed(0)}%`}
                  >
                    <Label
                      value="% of Suggestions Remaining"
                      angle={-90}
                      position="insideLeft"
                      style={{ fontSize: 11, textAnchor: 'start' }}
                      dy={80}                                     // ← lift text to top
                    />
                  </YAxis>
                  <Tooltip formatter={v => `${((v as any) * 100).toFixed(1)}%`} />
                  <Line type="monotone" dataKey="ratio" stroke="#8884d8" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </figure>

            {/* Dwell-time */}
            <figure className="flex-1 min-w-[300px]">
              <figcaption className="text-sm text-gray-600 mb-2">
                Percentage of all suggestions whose dwell-time ≥ the given threshold
              </figcaption>
              <h3 className="text-lg font-medium mb-2">
                Dwell-time Threshold vs % Remaining Suggestions
              </h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart
                  // width={500}
                  // height={200}
                  data={dwellRatioData}
                  margin={{ top: 20, right: 20, bottom: 20, left: 80 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="dwell"
                    tick={{ fontSize: 12 }}
                    label={{ value: 'Dwell-time Threshold (ms)', position: 'insideBottom', offset: -10, style: { fontSize: 12 } }}
                  />
                  <YAxis
                    domain={[0, 1]}
                    tick={{ fontSize: 12 }}
                    tickFormatter={v => `${(v * 100).toFixed(0)}%`}
                  >
                    <Label
                      value="% of Suggestions Remaining"
                      angle={-90}
                      position="insideLeft"
                      style={{ fontSize: 11, textAnchor: 'start' }}
                      dy={80}
                    />
                  </YAxis>
                  <Tooltip formatter={v => `${((v as any) * 100).toFixed(1)}%`} />
                  <Line type="monotone" dataKey="ratio" stroke="#8884d8" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </figure>
          </div>


          {/* ── Bucket Size vs. Acceptance Rate ─────────────────────────────────── */}  
          <div className="mt-6">
            <h3 className="text-lg font-medium mb-2">
              Acceptance Rate Over Time (Buckets of {(bucketSize/60).toFixed(1)}min)
            </h3>
            <label className="flex items-center gap-2">
              Bucket Size (s):
              <input
                type="range"
                min={5}
                max={1200}
                step={1}
                value={bucketSize}
                onChange={e => setBucketSize(+e.target.value)}
                className="mx-2"
              />
              <input
                type="number"
                min={5}
                max={1200}
                step={1}
                value={bucketSize}
                onChange={e => setBucketSize(e.target.value === '' ? 1 : Number(e.target.value))}
                className="w-16 border rounded p-1 text-sm"
              />
              <span>s</span> ({(bucketSize/60).toFixed(1)}min)
            </label>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart
                // width={1000}
                // height={200}
                data={bucketAcceptanceData}
                margin={{ top: 20, right: 20, bottom: 20, left: 80 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="start"
                  tick={{ fontSize: 12 }}
                  tickFormatter={v => `${(v/60).toFixed(1)}min`}
                  label={{
                    value: 'Task Duration Timeline (min)',
                    position: 'insideBottom',
                    offset: -10,
                    style: { fontSize: 12 }
                  }}
                />
                <YAxis /* …same as before… */>
                  <Label
                    value="% Suggestions Accepted"
                    angle={-90}
                    position="insideLeft"
                    style={{ fontSize: 12, textAnchor: 'start' }}
                    dy={75}
                  />
                </YAxis>
                {/* <Tooltip
                  formatter={v => (v == null ? '–' : `${((v as any) * 100).toFixed(1)}%`)}
                  labelFormatter={v => `${(v/60).toFixed(1)}min – ${((v + bucketSize)/60).toFixed(1)}min`}
                /> */}
                <Tooltip 
                  // we get the payload for this point, unpack rate & count:
                  content={({ payload, label }) => {
                    if (!payload?.length) return null;
                    const { rate, count } = payload[0].payload;
                    return (
                      <div className="recharts-default-tooltip" style={{ padding: 8 }}>
                        <div><strong>Time:</strong> {(label/60).toFixed(1)}–{((label+bucketSize)/60).toFixed(1)} min</div>
                        <div><strong>Acceptance:</strong> {rate == null ? '–' : `${(rate*100).toFixed(1)}%`}</div>
                        <div><strong># Suggestions:</strong> {count}</div>
                      </div>
                    );
                  }}
                  />
                <Line type="monotone" dataKey="rate" stroke="#ff7300" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* ── Acceptance Rate Over Relative Timeline ─────────────────────────────── */}
          <div className="mt-6">
            <h3 className="text-lg font-medium mb-2">
              Acceptance Rate Over Relative Timeline (4 buckets of 25%)
            </h3>
            <figcaption className="text-sm text-gray-600 mb-4">
            “Acceptance Rate Over Relative Timeline” shows how frequently autocomplete suggestions are accepted at different stages of task progress, with each participant’s timeline scaled from 0% (start) to 100% (finish). Suggestions are grouped into equal 25%‐wide bins (e.g. 0–25%, 25–50%, …), and for each bin the chart plots the proportion of suggestions that were accepted. By normalizing for individual pacing, you can see whether acceptance tends to rise, fall, or remain stable as users move through the task.
            </figcaption>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart
                data={relativeAcceptanceData}
                margin={{ top: 20, right: 20, bottom: 20, left: 80 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="lowPct"
                  tick={{ fontSize: 12 }}
                  tickFormatter={v => `${v}%`}
                  label={{
                    value: '% of Task Completed',
                    position: 'insideBottom',
                    offset: -10,
                    style: { fontSize: 12 }
                  }}
                />

                <YAxis
                  domain={[0, 0.3]}
                  tick={{ fontSize: 12 }}
                  tickFormatter={v => `${(v * 100).toFixed(0)}%`}
                >
                  <Label
                    value="% Suggestions Accepted"
                    angle={-90}
                    position="insideLeft"
                    style={{ fontSize: 12, textAnchor: 'start' }}
                    dy={75}
                  />
                </YAxis>
                <Tooltip
                  content={({ payload }) => {
                    if (!payload?.length) return null;
                    const { lowPct, highPct, rate, count } = payload[0].payload;
                    return (
                      <div className="recharts-default-tooltip" style={{ padding: 8 }}>
                        <div><strong>Range:</strong> {lowPct}% – {highPct}%</div>
                        <div><strong>Acceptance:</strong> {rate == null ? '–' : `${(rate*100).toFixed(1)}%`}</div>
                        <div><strong># Suggestions:</strong> {count}</div>
                      </div>
                    );
                  }}
                />

                <Line type="monotone" dataKey="rate" stroke="#1f77b4" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>


          {/* ── Bucket Size vs. Normalized Dwell Time ─────────────────────────────── */}
          <div className="mt-6">
            <h3 className="text-lg font-medium mb-2">
              Avg Normalized Dwell Time Over Time (Buckets of {(bucketSize/60).toFixed(1)} min)
            </h3>
            <label className="flex items-center gap-2 mb-4">
              Bucket Size (s):
              <input
                type="range"
                min={5}
                max={1200}
                step={1}
                value={bucketSize}
                onChange={e => setBucketSize(+e.target.value)}
                className="mx-2"
              />
              <input
                type="number"
                min={5}
                max={1200}
                step={1}
                value={bucketSize}
                onChange={e => setBucketSize(e.target.value === '' ? 1 : Number(e.target.value))}
                className="w-16 border rounded p-1 text-sm"
              />
              <span>s</span> ({(bucketSize/60).toFixed(1)} min)
            </label>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart
                data={bucketNormalizedDwellData}
                margin={{ top: 20, right: 20, bottom: 20, left: 80 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="start"
                  tick={{ fontSize: 12 }}
                  tickFormatter={v => `${(v/60).toFixed(1)}min`}
                  label={{
                    value: 'Task Duration Timeline (min)',
                    position: 'insideBottom',
                    offset: -10,
                    style: { fontSize: 12 }
                  }}
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  label={{
                    value: 'Avg Dwell (s/char)',
                    angle: -90,
                    position: 'insideLeft',
                    style: { fontSize: 12, textAnchor: 'start' },
                    dy: 75
                  }}
                />
                <Tooltip
                  labelFormatter={v => `${(v/60).toFixed(1)}min – ${((v + bucketSize)/60).toFixed(1)}min`}
                  formatter={val =>
                    val == null
                      ? ['–', 'Avg Norm. Dwell']
                      : [`${(val as any).toFixed(4)} s/char`, 'Avg Norm. Dwell']
                  }
                />
                <Line
                  type="monotone"
                  dataKey="avgNorm"
                  stroke="#82ca9d"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>



          {/* —————————————————————————————————————— */}
          {/* Side-by-Side Suggestion-Length Charts */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Cumulative Acceptance by Suggestion Length */}
            <div>
              <h3 className="text-lg font-medium mb-2">
                Cumulative Acceptance Ratio by Suggestion Length
              </h3>
              <figcaption className="text-sm text-gray-600 mb-4">
                We split all suggestions up to the maximum length into 50 bins of&nbsp;
                {suggestionLengthData[1]?.binSize ?? '–'} chars each.  
                Each point shows **all** suggestions ≥ that threshold:  
                bars = how many suggestions meet the threshold,  
                line = what percentage of them were accepted.  
                A cumulative curve makes it easy to pick the minimum length at which acceptance stays high.
              </figcaption>
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart
                  data={suggestionLengthData}
                  margin={{ top:20, right:20, bottom:20, left:80 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="threshold"
                    tick={{ fontSize:12 }}
                    label={{
                      value: 'Min Suggestion Length (chars)',
                      position: 'insideBottom',
                      offset: -10,
                      style: { fontSize:12 }
                    }}
                  />
                  {/* Left Y: cumulative % accepted */}
                  <YAxis
                    yAxisId="left"
                    domain={[0,1]}
                    tick={{ fontSize:12 }}
                    tickFormatter={v => `${(v*100).toFixed(0)}%`}
                  >
                    <Label
                      value="% Accepted (≥ threshold)"
                      angle={-90}
                      position="insideLeft"
                      style={{ fontSize:11, textAnchor:'start' }}
                      dy={80}
                    />
                  </YAxis>
                  {/* Right Y: count of suggestions */}
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize:12 }}
                  >
                    <Label
                      value="Count (≥ threshold)"
                      angle={-90}
                      position="insideRight"
                      style={{ fontSize:11, textAnchor:'end' }}
                      dy={-25}
                    />
                  </YAxis>
                  <Tooltip
                    labelFormatter={(threshold) => `Chars ≥ ${threshold}`}
                    formatter={(val, name) => {
                      if (name === 'acceptanceRatio')
                        return [`${((val as any) * 100).toFixed(1)}%`, '% Accepted'];
                      return [val, 'Count'];
                    }}
                  />
                  {/* bars for counts */}
                  <Bar
                    yAxisId="right"
                    dataKey="count"
                    barSize={20}
                    fill="#bbb"
                  />
                  {/* line for cumulative ratio */}
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="acceptanceRatio"
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Histogram of Suggestion Lengths */}
            <div>
              <h3 className="text-lg font-medium mb-2">Histogram of Suggestion Lengths</h3>
              <figcaption className="text-sm text-gray-600 mb-4">
                Shows how many suggestions fall into each character‐length bin (bin size ≈ 
                {suggestionLengthHistogram[0]?.binEnd ?? '–'} chars). <br/><br/><br/>
              </figcaption>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={suggestionLengthHistogram}
                  margin={{ top: 20, right: 20, bottom: 20, left: 40 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="binStart"
                    tick={{ fontSize: 12 }}
                    tickFormatter={v => `${v}`}
                    label={{
                      value: 'Chars (start of bin)',
                      position: 'insideBottom',
                      offset: -10,
                      style: { fontSize: 12 }
                    }}
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    label={{
                      value: 'Count',
                      angle: -90,
                      position: 'insideLeft',
                      style: { fontSize: 12, textAnchor: 'middle' }
                    }}
                  />
                  <Tooltip
                    labelFormatter={(value, payload) => {
                      if (!payload?.length) return '';
                      const { binStart, binEnd } = payload[0].payload;
                      return `Chars ${binStart}–${binEnd}`;
                    }}
                    formatter={val => [val, 'Count']}
                  />
                  <Bar
                    dataKey="count"
                    barSize={Math.max(2, suggestionLengthHistogram[0]?.binEnd / 4)}
                    fill="#8884d8"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Cumulative Avg Dwell Time by Suggestion Length */}
            <div>
              <h3 className="text-lg font-medium mb-2">
                Cumulative Avg Dwell Time by Suggestion Length
              </h3>
              <figcaption className="text-sm text-gray-600 mb-4">
                We use the same 50 bins of&nbsp;
                {suggestionLengthData[1]?.binSize ?? '–'} chars each.  
                Each point shows **all** suggestions ≥ that length threshold:  
                bars = how many suggestions meet the threshold,  
                line = their average dwell‐time (ms).  
                A cumulative view helps you see how dwell‐time evolves as suggestion length increases.
              </figcaption>
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart
                  data={suggestionLengthDwellData}
                  margin={{ top:20, right:20, bottom:20, left:80 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />

                  <XAxis
                    dataKey="threshold"
                    tick={{ fontSize:12 }}
                    label={{
                      value: 'Min Suggestion Length (chars)',
                      position: 'insideBottom',
                      offset: -10,
                      style: { fontSize:12 }
                    }}
                  />

                  {/* Left Y: avg dwell-time */}
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize:12 }}
                    tickFormatter={v => `${v.toFixed(0)}ms`}
                  >
                    <Label
                      value="Avg Dwell Time (ms)"
                      angle={-90}
                      position="insideLeft"
                      style={{ fontSize:11, textAnchor:'start' }}
                      dy={80}
                      offset={-10}
                    />
                  </YAxis>

                  {/* Right Y: count */}
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize:12 }}
                  >
                    <Label
                      value="Count (≥ threshold)"
                      angle={-90}
                      position="insideRight"
                      style={{ fontSize:11, textAnchor:'end' }}
                      dy={-20}
                    />
                  </YAxis>

                  <Tooltip
                    labelFormatter={threshold => `Chars ≥ ${threshold}`}
                    formatter={(val, name) => {
                      if (name === 'avgDwell')
                        return [`${(val as any).toFixed(1)}ms`, 'Avg Dwell'];
                      return [val, 'Count'];
                    }}
                  />

                  {/* bars for counts */}
                  <Bar
                    yAxisId="right"
                    dataKey="count"
                    barSize={20}
                    fill="#bbb"
                  />

                  {/* line for avg dwell */}
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="avgDwell"
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Cumulative Normalized Dwell Time by Suggestion Length */}
            <div>
              <h3 className="text-lg font-medium mb-2">
                Cumulative Normalized Dwell Time by Suggestion Length
              </h3>
              <figcaption className="text-sm text-gray-600 mb-4">
                Same 50 bins of&nbsp;
                {suggestionLengthNormDwellData[1]?.binSize ?? '–'} chars each.  
                Each point shows **all** suggestions ≥ that length:  
                bars = how many meet the threshold,  
                line = average dwell‐time **per character** (ms/char).  
                Normalizing lets you see if longer snippets get disproportionately more attention per char.
              </figcaption>
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart
                  data={suggestionLengthNormDwellData}
                  margin={{ top:20, right:20, bottom:20, left:80 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />

                  <XAxis
                    dataKey="threshold"
                    tick={{ fontSize:12 }}
                    label={{
                      value: 'Min Suggestion Length (chars)',
                      position: 'insideBottom',
                      offset: -10,
                      style: { fontSize:12 }
                    }}
                  />

                  {/* Left Y: avg norm. dwell (ms/char) */}
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize:12 }}
                    tickFormatter={v => `${v.toFixed(2)}ms/char`}
                  >
                    <Label
                      value="Avg Norm Dwell (ms/char)"
                      angle={-90}
                      position="insideLeft"
                      style={{ fontSize:11, textAnchor:'start' }}
                      dy={80}
                      offset={-35}
                    />
                  </YAxis>

                  {/* Right Y: count */}
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize:12 }}
                  >
                    <Label
                      value="Count (≥ threshold)"
                      angle={-90}
                      position="insideRight"
                      style={{ fontSize:11, textAnchor:'end' }}
                      dy={-20}
                    />
                  </YAxis>

                  <Tooltip
                    labelFormatter={threshold => `Chars ≥ ${threshold}`}
                    formatter={(val, name) => {
                      if (name === 'avgNorm')
                        return [`${(val as any).toFixed(2)}ms/char`, 'Avg Norm Dwell'];
                      return [val, 'Count'];
                    }}
                  />

                  {/* bars of counts */}
                  <Bar
                    yAxisId="right"
                    dataKey="count"
                    barSize={20}
                    fill="#bbb"
                  />

                  {/* line of normalized dwell */}
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="avgNorm"
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>


          </div>




          {/* Participant List */}
          <nav className="mb-8">
            <h2 className="text-xl font-semibold mb-2">Individual Reports</h2>
            <ul className="space-y-6">
              {statsList.map(s => (
                <li key={s.participantId}>
                  {s.error ? (
                    <div className="border p-4 rounded bg-red-100 text-red-700">
                      <strong>{s.participantId}</strong>: {s.error}
                    </div>
                  ) : (
                    <div className="border p-4 rounded">
                      <Link
                        href={`/report/${s.participantId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 font-medium hover:underline"
                      >
                        {s.participantId}
                      </Link>
                      <div className="mt-2 flex flex-wrap gap-4 text-sm">
                        <div><strong>Total:</strong> {s.total}</div>
                        <div>
                          <strong>Accepted:</strong> {s.acceptedCount} ({s.acceptedPct.toFixed(1)}%)
                        </div>
                        <div>
                          <strong>Not Accepted:</strong> {s.notAcceptedCount} ({s.notAcceptedPct.toFixed(1)}%)
                        </div>
                        <div>
                          <strong>Dur(ms):</strong> avg {s.durationSummary.avg.toFixed(1)}, 
                          min {s.durationSummary.min}, max {s.durationSummary.max}
                        </div>
                        <div>
                          <strong>Dwell(ms):</strong> avg {s.dwellSummary.avg.toFixed(1)}, 
                          min {s.dwellSummary.min}, max {s.dwellSummary.max}
                        </div>
                      </div>

                      {/* ── Timeline Chart ─────────────────────────── */}
                      {s.fullMaxEnd > 0 && (
                        <div className="mt-4 h-12 w-full bg-gray-200 rounded relative overflow-hidden">
                          {s.filteredRegions.map((r, i) => (
                            <div
                              key={i}
                              className={`absolute top-0 h-full ${
                                r.accepted ? 'bg-green-500' : 'bg-red-500'
                              }`}
                              style={{
                                left:  `${(r.start    / s.fullMaxEnd) * 100}%`,
                                width: `${(r.duration / s.fullMaxEnd) * 100}%`,
                              }}
                            />
                          ))}
                        </div>
                      )}

                      {/* ── Acceptance Bar Chart ───────────────────────── */}
                      {s.total > 0 && (
                        <div className="mt-4 h-4 w-full bg-red-300 rounded overflow-hidden">
                          <div
                            className="h-full bg-green-500"
                            style={{ width: `${(s.acceptedCount / s.total) * 100}%` }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        </>
      )}
    </div>
  );
}
