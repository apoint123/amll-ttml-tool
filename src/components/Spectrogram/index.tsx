import { audioBufferAtom, currentTimeAtom } from "$/states/audio.ts";
import { useAtomValue } from "jotai";
import { type FC, memo, useCallback, useEffect, useRef, useState } from "react";
import { LyricTimelineOverlay } from "./LyricTimelineOverlay";

const TILE_DURATION_S = 5;
const SPECTROGRAM_HEIGHT = 256;

interface TileComponentProps {
	tileId: string;
	left: number;
	width: number;
	canvasWidth: number;
	bitmap?: ImageBitmap;
}

const TileComponent = memo(
	({ tileId, left, width, canvasWidth, bitmap }: TileComponentProps) => {
		const canvasRef = useRef<HTMLCanvasElement>(null);

		useEffect(() => {
			if (bitmap && canvasRef.current) {
				const canvas = canvasRef.current;
				if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
				if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
				const ctx = canvas.getContext("2d");
				ctx?.drawImage(bitmap, 0, 0);
			}
		}, [bitmap]);

		return (
			<canvas
				ref={canvasRef}
				id={tileId}
				width={canvasWidth > 0 ? canvasWidth : 1}
				height={SPECTROGRAM_HEIGHT}
				style={{
					position: "absolute",
					left: `${left}px`,
					top: 0,
					width: `${width}px`,
					height: `${SPECTROGRAM_HEIGHT}px`,
					backgroundColor: bitmap ? "transparent" : "var(--gray-3)",
					imageRendering: "pixelated",
				}}
			/>
		);
	},
);

export const Spectrogram: FC = () => {
	const audioBuffer = useAtomValue(audioBufferAtom);
	const currentTimeInMs = useAtomValue(currentTimeAtom);
	const currentTime = currentTimeInMs / 1000;

	const [zoom, setZoom] = useState(500);
	const [gain, setGain] = useState(9.0);
	const [visibleTiles, setVisibleTiles] = useState<TileComponentProps[]>([]);
	const [renderTrigger, setRenderTrigger] = useState(0);

	const workerRef = useRef<Worker | null>(null);
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const tileCache = useRef<Map<string, ImageBitmap>>(new Map());
	const requestedTiles = useRef<Set<string>>(new Set());

	useEffect(() => {
		const worker = new Worker(
			new URL("../../workers/spectrogram.worker.ts", import.meta.url),
			{ type: "module" },
		);
		workerRef.current = worker;

		worker.onmessage = (event: MessageEvent) => {
			const { type, tileId, imageBitmap } = event.data;
			if (type === "TILE_READY" || type === "INIT_COMPLETE") {
				if (tileId && imageBitmap) {
					tileCache.current.set(tileId, imageBitmap);
				}
				setRenderTrigger((c) => c + 1);
			}
		};

		return () => worker.terminate();
	}, []);

	useEffect(() => {
		if (audioBuffer && workerRef.current) {
			tileCache.current.clear();
			requestedTiles.current.clear();
			setVisibleTiles([]);

			const channelData = audioBuffer.getChannelData(0);

			const channelDataCopy = channelData.slice();

			workerRef.current.postMessage(
				{
					type: "INIT",
					audioData: channelDataCopy,
					sampleRate: audioBuffer.sampleRate,
				},
				[channelDataCopy.buffer],
			);
		}
	}, [audioBuffer]);

	const updateVisibleTiles = useCallback(() => {
		if (!audioBuffer || !scrollContainerRef.current) return;

		const container = scrollContainerRef.current;
		const pixelsPerSecond = zoom;
		const tileDisplayWidthPx = TILE_DURATION_S * pixelsPerSecond;
		const totalTiles = Math.ceil(audioBuffer.duration / TILE_DURATION_S);

		const viewStart = container.scrollLeft;
		const viewEnd = viewStart + container.clientWidth;

		const firstVisibleIndex = Math.floor(viewStart / tileDisplayWidthPx);
		const lastVisibleIndex = Math.ceil(viewEnd / tileDisplayWidthPx);

		const newVisibleTiles: TileComponentProps[] = [];

		for (let i = firstVisibleIndex - 1; i <= lastVisibleIndex + 1; i++) {
			if (i < 0 || i >= totalTiles) continue;

			const tileId = `tile-${i}`;
			const tileStartTime = i * TILE_DURATION_S;

			if (
				!tileCache.current.has(tileId) &&
				!requestedTiles.current.has(tileId)
			) {
				requestedTiles.current.add(tileId);
				const renderWidth = Math.min(8192, Math.ceil(tileDisplayWidthPx));
				workerRef.current?.postMessage({
					type: "GET_TILE",
					tileId,
					startTime: tileStartTime,
					endTime: tileStartTime + TILE_DURATION_S,
					gain: gain,
					tileWidthPx: renderWidth,
				});
			}

			const bitmap = tileCache.current.get(tileId);
			newVisibleTiles.push({
				tileId,
				left: i * tileDisplayWidthPx,
				width: tileDisplayWidthPx,
				canvasWidth: bitmap?.width || Math.ceil(tileDisplayWidthPx),
				bitmap: bitmap,
			});
		}
		setVisibleTiles(newVisibleTiles);
	}, [audioBuffer, zoom, gain]);

	useEffect(() => {
		updateVisibleTiles();
	}, [audioBuffer, zoom, gain, renderTrigger, updateVisibleTiles]);

	const totalWidth = audioBuffer ? audioBuffer.duration * zoom : 0;
	const cursorPosition = currentTime * zoom;

	return (
		<div
			style={{
				height: "100%",
				display: "flex",
				flexDirection: "column",
				backgroundColor: "var(--gray-2)",
			}}
		>
			<div
				ref={scrollContainerRef}
				onScroll={updateVisibleTiles}
				style={{
					flexGrow: 1,
					overflowX: "auto",
					overflowY: "hidden",
					position: "relative",
				}}
			>
				<div
					style={{
						width: `${totalWidth}px`,
						height: "100%",
						position: "relative",
					}}
				>
					{visibleTiles.map((tile) => (
						<TileComponent key={tile.tileId} {...tile} />
					))}
					<div
						style={{
							position: "absolute",
							left: `${cursorPosition}px`,
							top: 0,
							width: "2px",
							height: "100%",
							backgroundColor: "var(--accent-9)",
							zIndex: 10,
							pointerEvents: "none",
						}}
					/>
					<LyricTimelineOverlay zoom={zoom} />
				</div>
			</div>
		</div>
	);
};

export default Spectrogram;
