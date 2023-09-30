declare type Options = {
    emit?: boolean;
    ignore?: string[];
};
export default function mod(inputDir: string, outputDir: string | undefined, options?: Options): Promise<{
    data: unknown;
    name: string;
}[] | undefined>;
export {};
//# sourceMappingURL=index.d.ts.map