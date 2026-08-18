// This is a small chart component, split out from page.js for one specific
// reason: recharts needs to run in the browser (it measures pixel sizes to
// draw the chart), so this file has to be a "client component". The
// "use client" line below is what tells Next.js that.
"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

// Draws a simple bar chart comparing messages sent vs. laugh reactions
// received, one bar pair per person. `people` is the array from
// stats.json.
export default function ReactionsChart({ people }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={people}>
          <XAxis dataKey="name" stroke="#9198a8" />
          <YAxis stroke="#9198a8" />
          <Tooltip
            contentStyle={{ background: "#191c24", border: "1px solid #2a2e3a" }}
          />
          <Bar dataKey="messagesSent" fill="#4a4e5c" name="Messages sent" />
          <Bar dataKey="laughs" fill="#ffcc4d" name="Laugh reactions" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
