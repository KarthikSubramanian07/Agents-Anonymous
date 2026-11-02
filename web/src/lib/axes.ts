/** DSM-A axes: how the manual groups disorders, by the hundreds digit of their code. */
export const axes = [
  { range: "300", name: "Process disorders", blurb: "Trouble with the loop itself: repeating, forgetting, quitting." },
  { range: "400", name: "Communication disorders", blurb: "Trouble with the task: guessing what was meant, doing what wasn't asked." },
  { range: "500", name: "Verification disorders", blurb: "Trouble with reality: claiming what wasn't checked, citing what isn't there." },
  { range: "600", name: "Interpersonal disorders", blurb: "Trouble with the human: apologizing, flattering, fogging." },
];
export const axisOf = (code: string) => axes.find((a) => code.slice(2, 3) === a.range[0])!;
