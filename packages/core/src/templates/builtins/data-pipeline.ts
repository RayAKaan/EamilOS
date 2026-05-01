import { Template } from '../types.js';

export const dataPipelineTemplate: Template = {
  id: 'data-pipeline',
  name: 'Data Pipeline',
  description: 'Python data processing pipeline with ingestion, transformation, and output stages',
  category: 'data',
  version: '1.0.0',
  author: 'EamilOS',
  tags: ['python', 'etl', 'data', 'pipeline', 'pandas'],

  workflow: {
    name: 'Build Data Pipeline',
    steps: [
      {
        phase: 'design',
        agent: 'auto',
        prompt: 'Design data pipeline architecture with ingestion, transformation, validation, and output stages.',
        expectedOutputs: ['docs/pipeline-design.md'],
      },
      {
        phase: 'core',
        agent: 'auto',
        prompt: 'Implement pipeline core with stage definitions, data flow, and error handling.',
        expectedOutputs: ['src/pipeline.py', 'src/stages/*.py'],
      },
      {
        phase: 'stages',
        agent: 'auto',
        prompt: 'Implement ingestion, transformation, and output stages.',
        expectedOutputs: ['src/stages/ingest.py', 'src/stages/transform.py', 'src/stages/output.py'],
      },
      {
        phase: 'tests',
        agent: 'auto',
        prompt: 'Write pytest tests for all pipeline stages.',
        expectedOutputs: ['tests/*.py'],
      },
    ],
  },

  files: [
    {
      path: 'pyproject.toml',
      template: `[project]
name = "{{projectName}}"
version = "0.1.0"
description = "{{description}}"
requires-python = ">=3.11"
dependencies = [
    "pandas>=2.0.0",
    "pydantic>=2.0.0",
    "click>=8.1.0",
    "rich>=13.0.0",
]

[project.optional-dependencies]
dev = ["pytest>=7.0.0", "pytest-cov>=4.0.0"]

[project.scripts]
{{binName}} = "{{projectName}}.cli:main"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"`,
      agent: 'auto',
    },
    {
      path: 'src/__init__.py',
      template: `"""{{projectName}} - Data processing pipeline."""`,
      agent: 'auto',
    },
    {
      path: 'src/pipeline.py',
      template: `"""Pipeline orchestrator that chains stages together."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

logger = logging.getLogger(__name__)


@dataclass
class PipelineContext:
    """Shared context passed between pipeline stages."""
    config: dict[str, Any] = field(default_factory=dict)
    data: Any = None
    artifacts: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


class Stage(Protocol):
    """Interface for pipeline stages."""
    name: str

    def run(self, ctx: PipelineContext) -> PipelineContext:
        ...


class Pipeline:
    """Orchestrates execution of pipeline stages."""

    def __init__(self) -> None:
        self._stages: list[Stage] = []

    def add(self, stage: Stage) -> None:
        self._stages.append(stage)

    def run(self, config: dict[str, Any] | None = None) -> PipelineContext:
        ctx = PipelineContext(config=config or {})
        logger.info("Pipeline starting with %d stages", len(self._stages))

        for stage in self._stages:
            logger.info("Running stage: %s", stage.name)
            try:
                ctx = stage.run(ctx)
            except Exception as e:
                ctx.errors.append(f"Stage '{stage.name}' failed: {e}")
                logger.error("Stage '%s' failed: %s", stage.name, e)
                break

        logger.info("Pipeline completed. Errors: %d", len(ctx.errors))
        return ctx`,
      agent: 'auto',
    },
    {
      path: 'src/stages/__init__.py',
      template: `"""Pipeline stages package."""`,
      agent: 'auto',
    },
    {
      path: 'src/stages/ingest.py',
      template: `"""Data ingestion stage - loads data from various sources."""
from __future__ import annotations

import pandas as pd
from pathlib import Path

from ..pipeline import PipelineContext, Stage


class IngestStage(Stage):
    """Ingests data from a file path defined in config."""

    name = "ingest"

    def __init__(self, source: str | None = None) -> None:
        self.source = source

    def run(self, ctx: PipelineContext) -> PipelineContext:
        source = self.source or ctx.config.get("source")
        if not source:
            raise ValueError("No data source specified. Set 'source' in config.")

        path = Path(source)
        if path.suffix == ".csv":
            ctx.data = pd.read_csv(path)
        elif path.suffix == ".json":
            ctx.data = pd.read_json(path)
        elif path.suffix in (".parquet", ".pq"):
            ctx.data = pd.read_parquet(path)
        else:
            raise ValueError(f"Unsupported file format: {path.suffix}")

        ctx.artifacts.append(str(path))
        return ctx`,
      agent: 'auto',
    },
    {
      path: 'src/stages/transform.py',
      template: `"""Data transformation stage."""
from __future__ import annotations

import pandas as pd

from ..pipeline import PipelineContext, Stage


class TransformStage(Stage):
    """Applies transformations to ingested data."""

    name = "transform"

    def run(self, ctx: PipelineContext) -> PipelineContext:
        if ctx.data is None:
            raise ValueError("No data to transform. Run ingest stage first.")

        df = ctx.data
        operations = ctx.config.get("transformations", [])

        for op in operations:
            op_type = op.get("type")
            if op_type == "drop_nulls":
                cols = op.get("columns")
                df = df.dropna(subset=cols) if cols else df.dropna()
            elif op_type == "rename_columns":
                df = df.rename(columns=op["mapping"])
            elif op_type == "filter":
                col, val = op["column"], op["value"]
                df = df[df[col] == val]

        ctx.data = df
        return ctx`,
      agent: 'auto',
    },
    {
      path: 'src/stages/output.py',
      template: `"""Output stage - writes processed data to destination."""
from __future__ import annotations

from pathlib import Path

from ..pipeline import PipelineContext, Stage


class OutputStage(Stage):
    """Writes processed data to the configured output path."""

    name = "output"

    def __init__(self, destination: str | None = None) -> None:
        self.destination = destination

    def run(self, ctx: PipelineContext) -> PipelineContext:
        if ctx.data is None:
            raise ValueError("No data to output. Run earlier stages first.")

        dest = self.destination or ctx.config.get("output")
        if not dest:
            raise ValueError("No output destination specified.")

        path = Path(dest)
        path.parent.mkdir(parents=True, exist_ok=True)

        if path.suffix == ".csv":
            ctx.data.to_csv(path, index=False)
        elif path.suffix == ".json":
            ctx.data.to_json(path, orient="records", indent=2)
        elif path.suffix == ".parquet":
            ctx.data.to_parquet(path, index=False)
        else:
            raise ValueError(f"Unsupported output format: {path.suffix}")

        ctx.artifacts.append(str(path))
        return ctx`,
      agent: 'auto',
    },
    {
      path: 'src/cli.py',
      template: `"""CLI interface for the data pipeline."""
from __future__ import annotations

import click
import logging
from rich.console import Console

from .pipeline import Pipeline
from .stages.ingest import IngestStage
from .stages.transform import TransformStage
from .stages.output import OutputStage

console = Console()
logger = logging.getLogger(__name__)


@click.group()
@click.option("-v", "--verbose", is_flag=True, help="Enable verbose logging")
def main(verbose: bool = False) -> None:
    """{{projectName}} - Data processing pipeline."""
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(level=level, format="%(levelname)s: %(message)s")


@main.command()
@click.option("-s", "--source", required=True, help="Input file path")
@click.option("-o", "--output", required=True, help="Output file path")
@click.option("-c", "--config", "config_file", help="YAML config file")
def run(source: str, output: str, config_file: str | None) -> None:
    """Run the data pipeline."""
    import yaml

    config = {}
    if config_file:
        with open(config_file) as f:
            config = yaml.safe_load(f) or {}

    config.setdefault("source", source)
    config.setdefault("output", output)

    pipeline = Pipeline()
    pipeline.add(IngestStage(source=source))
    pipeline.add(TransformStage())
    pipeline.add(OutputStage(destination=output))

    ctx = pipeline.run(config)

    if ctx.errors:
        console.print(f"[red]Pipeline completed with {len(ctx.errors)} error(s):")
        for err in ctx.errors:
            console.print(f"  - {err}")
        raise SystemExit(1)

    console.print(f"[green]Pipeline complete. Artifacts: {len(ctx.artifacts)}")`,
      agent: 'auto',
    },
  ],

  postGenerate: {
    commands: ['pip install -e ".[dev]"', 'pytest'],
    installDeps: true,
    gitInit: true,
  },

  estimatedCost: {
    min: 2.00,
    max: 3.50,
    currency: 'USD',
  },

  variables: [
    {
      name: 'projectName',
      type: 'string',
      description: 'Project name (Python package name)',
      default: 'data_pipeline',
      required: true,
    },
    {
      name: 'description',
      type: 'string',
      description: 'Project description',
      default: 'Data processing pipeline',
      required: false,
    },
    {
      name: 'binName',
      type: 'string',
      description: 'CLI binary name',
      default: 'dpipeline',
      required: false,
    },
  ],
};
