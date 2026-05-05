"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { aiApi } from "@/lib/api";
import { AIFields } from "@/types/vacancy";

interface Props {
  onExtracted: (fields: AIFields) => void;
}

export function DescriptionInput({ onExtracted }: Props) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const extract = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await aiApi.extractFromText(text);
      onExtracted(res.data);
    } catch {
      setError("Could not extract fields. Try again or fill manually.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <Textarea
        rows={8}
        placeholder="Paste or type the vacancy description here. AI will extract the structured fields automatically."
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="resize-none"
      />
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex justify-end">
        <Button onClick={extract} disabled={loading || !text.trim()}>
          {loading ? "Extracting..." : "Extract with AI"}
        </Button>
      </div>
    </div>
  );
}
