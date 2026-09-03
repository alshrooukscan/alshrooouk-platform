"use client";
import { useEffect, useRef } from "react";
import { supabase } from "./supabase";

// One hook, used on every dashboard list/detail page that needs to reflect a
// change made by someone else without a manual reload. Subscribes to Postgres
// changes on the given tables and calls the caller's own load function after
// a short debounce - several changes landing together (a visit plus its
// auto-created report row, for instance) trigger one reload, not three.
//
// employees and staff_profiles are deliberately never passed in here: Realtime
// broadcasts the full row over the wire regardless of column-level grants, so
// subscribing to either would leak salary/national_id/permissions straight
// past the lockdown those tables already have, through the payload instead
// of a query. Any page needing to react to an employee or staff change should
// refresh on a table that already carries a safe pointer to it (e.g. visits'
// assigned_employee_id) rather than subscribing to the row itself.
export function useAutoRefresh(tables, onChange) {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
    if (!tables || !tables.length) return;
    let timer = null;
    const trigger = () => {
      clearTimeout(timer);
      timer = setTimeout(() => cbRef.current(), 600);
    };

    const channelName = `auto-refresh-${tables.join("-")}-${Math.random().toString(36).slice(2, 8)}`;
    let channel = supabase.channel(channelName);
    tables.forEach((table) => {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, trigger);
    });
    channel.subscribe();

    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join("|")]);
}
