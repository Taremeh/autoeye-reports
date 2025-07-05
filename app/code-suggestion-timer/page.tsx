'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { coy as codeStyle } from 'react-syntax-highlighter/dist/esm/styles/prism';

// Helper to decode HTML entities (e.g. &nbsp;)
function decodeHtml(html) {
  const txt = document.createElement('textarea');
  txt.innerHTML = html;
  return txt.value;
}

export default function App() {
  const [suggestions, setSuggestions] = useState([]);
  const [current, setCurrent] = useState('');
  const [typed, setTyped] = useState('');
  const [duration, setDuration] = useState(500);

  const pauseDuration = 3000; // total time to type "Function = "
  const durationRef = useRef(duration);
  const timeoutsRef = useRef([]);

  // keep durationRef in sync
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  // load suggestions once
  useEffect(() => {
    fetch('/160603/html_160603.json')
      .then(res => res.json())
      .then(data => {
        const items = Object.values(data)
          .map(item => decodeHtml(item).replace(/<[^>]+>/g, ''));
        setSuggestions(items);
      })
      .catch(console.error);
  }, []);

  // main cycle: only depends on suggestions
  useEffect(() => {
    if (!suggestions.length) return;

    // clear any old timeouts
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];

    let isActive = true;
    const placeholder = 'Function = ';
    const chars = placeholder.split('');
    const charInterval = pauseDuration / chars.length;

    const cycle = () => {
      if (!isActive) return;

      // reset text
      setTyped('');
      setCurrent('');

      // type out each character
      chars.forEach((ch, idx) => {
        const t = setTimeout(() => {
          setTyped(prev => prev + ch);
        }, idx * charInterval);
        timeoutsRef.current.push(t);
      });

      // after typing completes, show a suggestion and schedule next cycle
      const tShow = setTimeout(() => {
        if (!isActive) return;
        const rand = Math.floor(Math.random() * suggestions.length);
        setCurrent(suggestions[rand]);

        // schedule next cycle based on the *latest* slider value
        const tNext = setTimeout(cycle, durationRef.current);
        timeoutsRef.current.push(tNext);
      }, pauseDuration);

      timeoutsRef.current.push(tShow);
    };

    cycle();

    return () => {
      isActive = false;
      timeoutsRef.current.forEach(clearTimeout);
      timeoutsRef.current = [];
    };
  }, [suggestions]);

  return (
    <div style={{ backgroundColor: '#fff', color: '#000', padding: '1rem', height: '100vh', fontFamily: 'Arial, sans-serif' }}>
      <h1>Code Suggestion Timer Tool</h1>
      <br/>
      <p>
        This tool simulates the presentation of a code suggestion, allowing you to experience visually how long manually adjustable appearance durations feel.
        The suggestion is displayed on line 5 after typing "Function = " for the specified duration.
      </p>
      <br/>

      <div style={{ marginBottom: '1rem' }}>
        <label>
          Suggestion duration (ms):
          <input
            type="number"
            min="0"
            max="5000"
            value={duration}
            onChange={e => setDuration(Number(e.target.value))}
            style={{ width: '60px', margin: '0 0.5rem' }}
          />
        </label>
        <input
          type="range"
          min="0"
          max="5000"
          value={duration}
          onChange={e => setDuration(Number(e.target.value))}
          style={{ verticalAlign: 'middle' }}
        />
      </div>

      <SyntaxHighlighter language="javascript" style={codeStyle} showLineNumbers>
{`useEffect(() => {
  const testKey = 'foo-123';

  const test${typed}${current}

  if (error) return <div>Error: {error.message}</div>;
  if (!testData) return <div>Loading…</div>;

    return (
        <div>
        <h2>Test Data</h2>
        <pre>{JSON.stringify(testData, null, 2)}</pre>
        </div>
    );
}, []);`}
      </SyntaxHighlighter>
    </div>
  );
}
