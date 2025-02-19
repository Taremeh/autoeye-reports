"use client";
import { useState } from 'react';

export const Accordion = ({ title, children }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mb-8 bg-gray-100">
      <h2
        className="mb-2 text-xl font-semibold tracking-tighter capitalize cursor-pointer pt-4 pl-4 pr-4 md:pt-10 md:pl-10 md:pr-10"
        onClick={() => setIsOpen(true)}
      >
        {title}
      </h2>
      <div className={`relative transition-all duration-300 ${isOpen ? 'max-h-full opacity-100' : 'max-h-24 opacity-100'}`} onClick={() => setIsOpen(true)}>
        <div className={`overflow-hidden ${isOpen ? '' : 'line-clamp-2'} pl-4 pr-4 md:pl-10 md:pr-10`}>
          {children}
        </div>
        {!isOpen && (
          <div className="absolute inset-0 bg-gradient-to-t from-white to-transparent pointer-events-none"></div>
        )}
      </div>
      {isOpen ? '' : (<p className="text-xs pt-5 cursor-pointer bg-white text-center" onClick={() => setIsOpen(true)}>click to expand for more information...</p>)}
    </div>
  );
};