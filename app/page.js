// This is the home page. Right now it's a TEMPORARY stand-in for the real
// dashboard (funniest_friend_dashboard.jsx), which hasn't been added to the
// project yet. Once that file exists, it should replace the contents of
// this file. This placeholder exists so we can confirm the data (stats.json)
// and the installed libraries (Tailwind, lucide-react, recharts) actually
// work before the real design goes in.

import { Trophy, Laugh } from "lucide-react";
import ReactionsChart from "./ReactionsChart";
import stats from "../public/stats.json";

export default function HomePage() {
  // Sort a copy of the people list so whoever has the most laugh reactions
  // shows up first. We copy with [...stats.people] instead of sorting the
  // original array, just to be safe and not change the data we imported.
  const peopleSortedByLaughs = [...stats.people].sort((a, b) => b.laughs - a.laughs);

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="mb-2 flex items-center gap-2 text-3xl font-bold">
        <Trophy className="text-yellow-400" />
        Funniest Friend
      </h1>
      <p className="mb-8 text-gray-400">
        Placeholder page. Waiting on the real dashboard component
        (funniest_friend_dashboard.jsx) to be added to this project.
      </p>

      <p className="mb-6 rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm text-gray-400">
        Chat: <strong>{stats.chatName}</strong> &middot; {stats.totalMessages} messages
      </p>

      <ol className="mb-10 flex flex-col gap-3">
        {peopleSortedByLaughs.map((person, index) => (
          <li
            key={person.name}
            className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-900 px-4 py-3"
          >
            <div>
              <span className="mr-2 font-bold text-gray-500">#{index + 1}</span>
              <span className="font-semibold">{person.name}</span>
              <p className="text-sm text-gray-400">{person.messagesSent} messages sent</p>
            </div>
            <div className="flex items-center gap-1 text-xl font-bold text-yellow-400">
              <Laugh size={20} />
              {person.laughs}
            </div>
          </li>
        ))}
      </ol>

      <ReactionsChart people={peopleSortedByLaughs} />
    </main>
  );
}
