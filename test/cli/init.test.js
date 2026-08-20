const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const init = require('../../cli/init');

const {
  _describesSameCourse: describesSameCourse,
  _describeSyncTarget: describeSyncTarget,
} = init;

const URL = 'https://school.instructure.com';

/** Sync state as a course that has been pushed to leaves it. */
function synced(overrides = {}) {
  return {
    schema_version: 4,
    canvas_base_url: URL,
    course_id: 45083,
    modules: {
      '01-intro': { canvas_module_id: 100, item_order: [], items: {} },
    },
    icons: {},
    files: {},
    ...overrides,
  };
}

describe('describesSameCourse', () => {
  it('recognises a re-init of the same course', () => {
    assert.equal(
      describesSameCourse(synced(), { courseId: '45083', canvasBaseUrl: URL }),
      true,
    );
  });

  it('compares a stored number against an entered string', () => {
    assert.equal(
      describesSameCourse(synced({ course_id: 45083 }), {
        courseId: 45083,
        canvasBaseUrl: URL,
      }),
      true,
    );
  });

  it('rejects a different course', () => {
    assert.equal(
      describesSameCourse(synced(), { courseId: '58155', canvasBaseUrl: URL }),
      false,
      'those module ids belong to 45083 and mean nothing in 58155',
    );
  });

  it('rejects the same course id on a different instance', () => {
    assert.equal(
      describesSameCourse(synced(), {
        courseId: '45083',
        canvasBaseUrl: 'https://other.instructure.com',
      }),
      false,
    );
  });

  it('ignores a base URL that differs only by punctuation', () => {
    assert.equal(
      describesSameCourse(synced({ canvas_base_url: `${URL}/api/v1` }), {
        courseId: '45083',
        canvasBaseUrl: `${URL}/`,
      }),
      true,
    );
  });

  it('keeps the mappings of a file that claims no course', () => {
    // Written while CANVAS_COURSE_ID was unset: it was built against whatever
    // course was configured then, which is the one being named now.
    assert.equal(
      describesSameCourse(synced({ course_id: 0 }), {
        courseId: '45083',
        canvasBaseUrl: URL,
      }),
      true,
    );

    const noField = synced();
    delete noField.course_id;
    assert.equal(
      describesSameCourse(noField, { courseId: '45083', canvasBaseUrl: URL }),
      true,
    );
  });

  it('does not judge on a base URL the file never recorded', () => {
    assert.equal(
      describesSameCourse(synced({ canvas_base_url: '' }), {
        courseId: '45083',
        canvasBaseUrl: URL,
      }),
      true,
    );
  });
});

describe('describeSyncTarget', () => {
  it('names the course and the instance', () => {
    assert.equal(
      describeSyncTarget(synced()),
      `course 45083 on ${URL}`,
      'the line explains which ids are being dropped, so it names their course',
    );
  });

  it('drops the instance when the file never recorded one', () => {
    assert.equal(
      describeSyncTarget(synced({ canvas_base_url: '' })),
      'course 45083',
    );
  });

  it('stays readable when the file claims no course', () => {
    assert.equal(
      describeSyncTarget(synced({ course_id: 0 })),
      `another course on ${URL}`,
    );
  });
});
