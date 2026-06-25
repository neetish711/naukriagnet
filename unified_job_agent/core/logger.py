"""Rich-based terminal logging with progress bars."""
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, BarColumn, TextColumn, TimeElapsedColumn
from rich.table import Table
from rich.theme import Theme
from rich import print as rprint
import logging

_theme = Theme({
    "info": "cyan",
    "success": "bold green",
    "warning": "yellow",
    "error": "bold red",
    "stage": "bold magenta",
})

console = Console(theme=_theme)


def info(msg: str):
    console.print(f"[info]ℹ  {msg}[/info]")


def success(msg: str):
    console.print(f"[success]✔  {msg}[/success]")


def warning(msg: str):
    console.print(f"[warning]⚠  {msg}[/warning]")


def error(msg: str):
    console.print(f"[error]✘  {msg}[/error]")


def stage(name: str):
    console.rule(f"[stage]{name}[/stage]")


def make_progress() -> Progress:
    return Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
        TimeElapsedColumn(),
        console=console,
    )
