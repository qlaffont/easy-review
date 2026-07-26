import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

const filesSearchSchema = z.object({
    path: z.string().optional(),
});

/** Old `/files` URLs land on the overview review section. */
export const Route = createFileRoute("/pr/$owner/$repo/$number_/files")({
    validateSearch: filesSearchSchema,
    beforeLoad: ({ params, search }) => {
        throw redirect({
            to: "/pr/$owner/$repo/$number",
            params,
            search: search.path ? { path: search.path } : {},
            hash: "review",
        });
    },
});
