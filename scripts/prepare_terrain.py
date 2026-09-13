"""Compatibility entry point for the current offline terrain preparation."""
import pathlib
import runpy

SCRIPT = pathlib.Path(__file__).with_name("prepare_inds_terrain.py")
if __name__ == "__main__":
    runpy.run_path(str(SCRIPT), run_name="__main__")
