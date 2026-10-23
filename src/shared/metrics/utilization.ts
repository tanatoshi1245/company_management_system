/** 比率。分母が 0 / null なら null（画面では「—」） */
export function rate(num: number | null | undefined, den: number | null | undefined): number | null {
  if (num === null || num === undefined || !den) return null;
  return num / den;
}

export function jobUtilization(activeJobs: number, jobLimit: number | null): number | null {
  return rate(activeJobs, jobLimit);
}

export function scoutUtilization(sent: number, scoutLimit: number | null): number | null {
  return rate(sent, scoutLimit);
}

export function perActiveJob(x: number, activeJobs: number): number | null {
  return rate(x, activeJobs);
}
