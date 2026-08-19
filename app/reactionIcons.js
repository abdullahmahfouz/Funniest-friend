// Maps each of the six iMessage tapback types (see lib/scoreMessages.js)
// to its lucide icon. Kept in one place, in a fixed order, so the winner
// card and every leaderboard row render the same icons in the same order
// -- only the counts differ.
import { Heart, ThumbsUp, ThumbsDown, Laugh, Flame, HelpCircle } from "lucide-react";

export const REACTION_ICONS = [
  { key: "loved", label: "Loved", Icon: Heart },
  { key: "liked", label: "Liked", Icon: ThumbsUp },
  { key: "disliked", label: "Disliked", Icon: ThumbsDown },
  { key: "laughed", label: "Laughed", Icon: Laugh },
  { key: "emphasized", label: "Emphasized", Icon: Flame },
  { key: "questioned", label: "Questioned", Icon: HelpCircle },
];
