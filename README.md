# S&W Multi-Class

A Foundry VTT module for the **Swords & Wizardry** system that adds multi-class and dual-class character progression support without modifying the S&W Actor schema.

## Features

- Multi-Class mode for concurrent classes
- Dual-Class mode for former and current classes
- Per-class level, XP, XP bonus, and status tracking
- Shared XP tracking for Multi-Class characters
- Optional synchronization to the stock S&W Class, Level, XP, and XP Bonus fields
- Progression data stored in module flags

## Compatibility

- Foundry VTT 14
- Swords & Wizardry 4.2.x

## Development note

The stock S&W character sheet renders Level and XP with numeric coercion even though those model fields are strings. Composite values such as `3 / 2` therefore become `NaN`. This module keeps the stock Level and XP fields numeric-only and displays the real multi-class progression in its own Class Progression panel.
