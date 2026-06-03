export interface EloRatingChange {
  userId: string;
  before: number;
  after: number;
}

export function calculateInitialElo(): number {
  return 1000;
}
