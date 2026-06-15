function factorial(n: number): number {
  let r = 1
  for (let i = 2; i <= n; i++) r *= i
  return r
}

function erlangC(N: number, A: number): number {
  if (N <= A) return 1
  let sum = 0
  let term = 1
  for (let k = 1; k <= N - 1; k++) {
    term *= A / k
    sum += term
  }
  const lastTerm = (Math.pow(A, N) / factorial(N)) * (N / (N - A))
  return lastTerm / (sum + 1 + lastTerm)
}

function serviceLevel(N: number, A: number, aht: number, targetSec: number): number {
  if (N <= A) return 0
  return 1 - erlangC(N, A) * Math.exp(-(N - A) * (targetSec / aht))
}

export function requiredAgents(
  callsPerHour: number,
  ahtSec: number,
  targetSl = 80,
  targetSec = 20,
): number {
  if (callsPerHour === 0 || ahtSec === 0) return 0
  const A = (callsPerHour / 3600) * ahtSec
  let N = Math.max(1, Math.ceil(A) + 1)
  while (N < 500) {
    if (serviceLevel(N, A, ahtSec, targetSec) >= targetSl / 100) break
    N++
  }
  return N
}
