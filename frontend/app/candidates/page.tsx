"use client";

import { useState, useEffect } from "react";
import { CandidateCard } from "@/components/candidates/CandidateCard";
import { candidateApi } from "@/lib/api";
import { Candidate } from "@/types/candidate";
import useSWR from "swr";

const PAGE_SIZE = 20;

function useDebounce(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function CandidatesPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading } = useSWR(
    ["all-candidates", debouncedSearch, page],
    () =>
      candidateApi
        .list({ skip: page * PAGE_SIZE, limit: PAGE_SIZE, search: debouncedSearch || undefined })
        .then((r) => r.data),
    { keepPreviousData: true }
  );

  const candidates: Candidate[] = (data?.items as Candidate[]) ?? [];
  const total: number = data?.total ?? 0;
  const pageCount = Math.ceil(total / PAGE_SIZE);

  const handleSearch = (val: string) => {
    setSearch(val);
    setPage(0);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Candidates</h1>
          {total > 0 && (
            <p className="mt-0.5 text-sm text-gray-400">{total} matched across all vacancies</p>
          )}
        </div>
        <div className="relative">
          <input
            type="text"
            placeholder="Search candidates..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-4 text-sm text-gray-700 placeholder-gray-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 w-56"
          />
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      {isLoading && candidates.length === 0 ? (
        <div className="flex justify-center pt-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        </div>
      ) : candidates.length === 0 ? (
        <div className="pt-16 text-center text-gray-400">
          {search ? (
            <p>No candidates matching &ldquo;{search}&rdquo;</p>
          ) : (
            <>
              <p>No candidates yet</p>
              <p className="mt-1 text-sm">Approve a vacancy and run Smart Rematch to find candidates</p>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="py-2.5 pl-4 pr-3 text-xs font-medium text-gray-400 uppercase tracking-wide">Name</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">Position</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">Area</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">Salary</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide">Skills</th>
                  <th className="px-3 py-2.5 pr-4 text-xs font-medium text-gray-400 uppercase tracking-wide">Resume</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {candidates.map((c) => (
                  <CandidateCard key={c.id} candidate={c} />
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
              <span>{total} candidates</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => p - 1)}
                  disabled={page === 0}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ← Prev
                </button>
                <span className="text-gray-400">
                  {page + 1} / {pageCount}
                </span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page + 1 >= pageCount}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
