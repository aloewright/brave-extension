-- 0007_tool_trace.sql
-- Structured trace of Code Mode tool calls for an assistant message (JSON array),
-- so tool-using turns remain replayable. Nullable; plain-chat turns leave it null.
ALTER TABLE agent_messages ADD COLUMN tool_trace TEXT;
